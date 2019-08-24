const express = require('express');
const app = express();
const http = require('http').Server(app);
const bodyParser = require('body-parser');
const io = require('socket.io')(http);
const PORT = process.env.PORT || 7000;
const events = require('events');
const eventEmitter = new events.EventEmitter();
eventEmitter.setMaxListeners(50)

let socetIDtoInfo = {};
let roomIDtoDoraftedList = {};
let roomIDtoReady = {};
let roomIDtoClientNum = [];
let draftChoiceTemp = [];

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.set("view engine", "ejs");

app.use(express.static(__dirname + '/views/css'));
app.use(express.static(__dirname + '/views/js'));

http.listen(PORT, () => {
    console.log(`server listening. Port: ${PORT}`);
});


app.get('/', (req, res) => {
    res.render("./pages/index.ejs", {
        msg: ""
    });

});

/********************** room遷移時*************************/
app.post('/room', function (req, res) {
    if (req.body.drafted !== void 0) {
         //host
        io.of('/').in(req.body.id).clients(function (error, clients) {
            if (roomIDtoDoraftedList[req.body.id] !== void 0) {
                //使用中
                res.render("./pages/index.ejs", {
                    msg: "同名のIDの部屋が存在します。"
                });
            } else {
                //OK
                res.render("./pages/room.ejs", {
                    name: req.body.name,
                    id: req.body.id,
                    title: req.body.title,
                    end: req.body.end
                });
                roomIDtoDoraftedList[req.body.id] = {
                    list: createDoraftedListHTML(req.body.drafted),
                    status: "wait",
                    title: req.body.title,
                    end: req.body.end
                }
            }
        });

    } else {
        //guest
        io.of('/').in(req.body.id).clients(function (error, clients) {
            if (roomIDtoDoraftedList[req.body.id] === void 0 || roomIDtoDoraftedList[req.body.id].status != "wait") {
                res.render("./pages/index.ejs", {
                    msg: "部屋が存在しないか、既に進行中です。"
                });
                return;
            }
            res.render("./pages/room.ejs", {
                name: req.body.name,
                id: req.body.id,
                title: req.body.title,
                end: req.body.end
            });
        });
    }

    io.once('connection', function (socket) {
        socket.join(req.body.id);
        io.to(socket.id).emit('create_draftedList', roomIDtoDoraftedList[req.body.id]);
        socetIDtoInfo[socket.id] = {
            name: req.body.name,
            id: req.body.id
        }
        io.of('/').in(req.body.id).clients(function (error, clients) {
            io.to(socetIDtoInfo[socket.id].id).emit('create_member', createMemberListHTML(clients), createMemberListHTML2(clients));

            if (clients.length === 1) {
                io.to(socket.id).emit('host');
            }
        });
        io.to(socket.id).emit('create_draftedList', roomIDtoDoraftedList[req.body.id]);

        socket.on('exit', () => {
            io.of('/').in(socetIDtoInfo[socket.id].id).clients(function (error, clients) {
                socket.leave( socetIDtoInfo[socket.id].id);
                if (clients.length === 1) {
                    roomIDtoDoraftedList[ socetIDtoInfo[socket.id].id] = undefined;
                    socetIDtoInfo[socket.id] = undefined;
                }
                socket.disconnect(socket.id);
            });
        });
        socket.on('end', () => {
            roomIDtoDoraftedList[socetIDtoInfo[socket.id].id] = undefined;
        });
        
    });
});

/***************************************************/
//接続
io.on('connection', function (socket) {
    socket.on('ready', () => {
        const roomID = socetIDtoInfo[socket.id].id;
        roomIDtoDoraftedList[roomID].status = "start";
        roomIDtoReady[roomID] = 0;
        io.to(roomID).emit('start');
        io.of('/').in(roomID).clients((error, clients) => {
            roomIDtoClientNum[roomID] = clients.length;
        })
    });
    socket.on('nomination', doraftChoice => {
        const roomID = socetIDtoInfo[socket.id].id;
        roomIDtoReady[roomID]++;
        io.of('/').in(roomID).clients((error, clients) => {
            draftChoiceTemp[socket.id] = doraftChoice;
            if (roomIDtoClientNum[roomID] == roomIDtoReady[roomID]) {
                //全員選択した
                roomIDtoReady[roomID] = 0;

                let draftsChoiceList = []
                let draftStatus = []
                for (let i = 0; i < clients.length; i++) {
                    draftsChoiceList[i] = draftChoiceTemp[clients[i]]
                    draftStatus[i] = "決定済み";
                }

                //競合なしなら決定
                let b1 = draftsChoiceList.filter((val, idx, self) => {
                    return self.indexOf(val) === self.lastIndexOf(val);
                });
                for (let i = 0; i < b1.length; i++) {
                    draftStatus[draftsChoiceList.indexOf(b1[i])] = "今回決定";
                }

                //競合してる配列
                let d = draftsChoiceList.filter(function (x, i, self) {
                    return self.indexOf(x) === i && i !== self.lastIndexOf(x);
                });

                //競合
                let clientInfo = [];
                for (let i = 0; i < draftStatus.length; i++) {
                    clientInfo[i] = (
                        {
                            name: socetIDtoInfo[clients[i]].name,
                            socketID: clients[i],
                            doraft: draftsChoiceList[i]
                        }
                    );
                }

                for (let i = 0; i < d.length; i++) {
                    const result = draftsChoiceList.reduce(function (accumulator, currentValue, index) {
                        if (currentValue === d[i]) {
                            accumulator.push(index);
                        }
                        return accumulator;
                    }, [])
                    const random = result[Math.floor(Math.random() * result.length)];
                    draftStatus[random] = "今回決定";

                }

                for (let i = 0; i < draftStatus.length; i++) {
                    if (draftStatus[i] !== "今回決定") {
                        draftStatus[i] = "再指名";
                    }
                }

                const count = draftStatus.filter(x => {
                    return x === "再指名"
                }).length

                roomIDtoClientNum[socetIDtoInfo[socket.id].id] = count;

                for (let i = 0; i < draftStatus.length; i++) {
                    io.to(socetIDtoInfo[socket.id].id).emit('doraftedAlready', draftsChoiceList[i]);
                    if (roomIDtoClientNum[socetIDtoInfo[socket.id].id] === 0) {
                        //一巡終了
                        if (i === draftStatus.length - 1) {
                            roomIDtoClientNum[socetIDtoInfo[socket.id].id] = clients.length;
                        }
                        if (draftStatus[i] === "今回決定") {
                            io.to(clientInfo[i].socketID).emit('determination', clients.length, draftsChoiceList, clientInfo);
                        } else {
                            io.to(clientInfo[i].socketID).emit('already', clients.length, draftsChoiceList, clientInfo);
                        }
                    } else {
                        if (draftStatus[i] === "今回決定") {
                            io.to(clientInfo[i].socketID).emit('determination2', clients.length, draftsChoiceList, clientInfo);
                        } else if (draftStatus[i] === "再指名") {
                            io.to(clientInfo[i].socketID).emit('reDoraft2', clients.length, draftsChoiceList, clientInfo);
                        } else {
                            io.to(clientInfo[i].socketID).emit('already2', clients.length, draftsChoiceList, clientInfo);
                        }
                    }
                }

            }
        });
    });
});


const createDoraftedListHTML = doraftedList => {
    let str_ = "";
    doraftedList.split(/\n/).forEach(str => {
        str_ += `<li>${str}</li>\n`;
    });
    return str_;
}

const createMemberListHTML = memberList => {
    let str_ = "";
    memberList.forEach(str => {
        str_ += `<li>${socetIDtoInfo[str].name}</li>`;
    });
    return str_;
}

const createMemberListHTML2 = memberList => {
    let str_ = "<th></th>";
    memberList.forEach(str => {
        str_ += `<th>${socetIDtoInfo[str].name}</th>`;
    });
    return str_;
}
