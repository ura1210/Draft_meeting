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
let RoomIDtoDoraftedList = {};
let RoomIDtoReady = {};
let RoomIDtoClientNum = [];
let doraftChoiceTemp = [];

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.set("view engine", "ejs");

app.use(express.static(__dirname + '/views/css'));
app.use(express.static(__dirname + '/views/js'));

app.get('/', (req, res) => {
    res.render("./pages/index.ejs", {
        msg: ""
    });

});

/********************** room遷移時*************************/
app.post('/room', function (req, res) {
    if (req.body.drafted != void 0) {
        io.of('/').in(req.body.id).clients(function (error, clients) {
            if (RoomIDtoDoraftedList[req.body.id] !== void 0) {
                res.redirect(302, "/");
                return;
            } else {
                res.render("./pages/room.ejs", {
                    name: req.body.name,
                    id: req.body.id,
                    title: req.body.title
                });
                RoomIDtoDoraftedList[req.body.id] = { list: createDoraftedListHTML(req.body.drafted), status: "wait", title: req.body.title }
            }
        });

    } else {
        io.of('/').in(req.body.id).clients(function (error, clients) {
        if (RoomIDtoDoraftedList[req.body.id] === void 0 || RoomIDtoDoraftedList[req.body.id].status != "wait" || clients.length > 5) {
            res.render("./pages/index.ejs", {
                msg: "部屋が存在しないか、既に進行中です。"
            });
            return;
        }
        res.render("./pages/room.ejs", {
            name: req.body.name,
            id: req.body.id,
            title: req.body.title
        });
    });
    }

    io.once('connection', function (socket) {
        socket.join(req.body.id);
        RoomIDtoReady[req.body.id] = 0;
        io.to(req.body.id).emit('reset');
        io.to(socket.id).emit('create_draftedList', RoomIDtoDoraftedList[req.body.id]);
        socetIDtoInfo[socket.id] = {
            name: req.body.name,
            id: req.body.id
        }
        io.of('/').in(req.body.id).clients(function (error, clients) {
            io.to(socetIDtoInfo[socket.id].id).emit('create_member', createMemberListHTML(clients), createMemberListHTML2(clients));
        });
        io.to(socket.id).emit('create_draftedList', RoomIDtoDoraftedList[req.body.id]);

        socket.on('exit', () => {
            io.of('/').in(socetIDtoInfo[socket.id].id).clients(function (error, clients) {
                socket.leave(Object.keys(socket.rooms)[1]);
                if (clients.length == 1) {
                    RoomIDtoDoraftedList[Object.keys(socket.rooms)[1]] = undefined;
                    socetIDtoInfo[socket.id] = undefined;
                }
                socket.disconnect(socket.id);
            });
        });
        socket.on('end', () => {
            RoomIDtoDoraftedList[socetIDtoInfo[socket.id].id] = null;
        });
    });
});

/***************************************************/
//接続
io.on('connection', function (socket) {
    socket.on('ready', () => {
        const roomID = Object.keys(socket.rooms)[1];
        RoomIDtoReady[roomID]++;
        io.of('/').in(roomID).clients((error, clients) => {
            if (clients.length == RoomIDtoReady[roomID]) {
                //全員Readyを押した
                RoomIDtoDoraftedList[roomID].status = "start";
                RoomIDtoReady[roomID] = 0;
                io.to(roomID).emit('start');
                RoomIDtoClientNum[roomID] = clients.length;
            }
        });
    });
    socket.on('nomination', doraftChoice => {
        const roomID = Object.keys(socket.rooms)[1];
        RoomIDtoReady[roomID]++;
        io.of('/').in(roomID).clients((error, clients) => {
            doraftChoiceTemp[socket.id] = doraftChoice;
            if (RoomIDtoClientNum[roomID] == RoomIDtoReady[roomID]) {
                //全員選択した
                RoomIDtoReady[roomID] = 0;

                let dorafthairetu = []
                for (let i = 0; i < clients.length; i++) {
                    dorafthairetu[i] = doraftChoiceTemp[clients[i]]
                }
                //配列つくる
                let doraftStatus = []
                for (let i = 0; i < clients.length; i++) {
                    doraftStatus[i] = "決定済み";
                }

                //競合なしなら決定
                let b1 = dorafthairetu.filter((val, idx, self) => {
                    return self.indexOf(val) === self.lastIndexOf(val);
                });
                for (let i = 0; i < b1.length; i++) {
                    doraftStatus[dorafthairetu.indexOf(b1[i])] = "今回決定";
                }

                //競合してる配列
                var d = doraftStatus.filter(function (x, i, self) {
                    return self.indexOf(x) === i && i !== self.lastIndexOf(x);
                });

                //競合
                let a = [];
                for (let i = 0; i < doraftStatus.length; i++) {
                    a[i] = (
                        {
                            name: socetIDtoInfo[clients[i]].name,
                            socketID: clients[i],
                            doraft: dorafthairetu[i]
                        }
                    );
                }
                
                for (let i = 0; i < d.length; i++) {
                    const result = doraftStatus.reduce(function (accumulator, currentValue, index) {
                        if (currentValue === d[i]) {
                            accumulator.push(index);
                        }
                        return accumulator;
                    }, [])
                    const random = result[Math.floor(Math.random() * result.length)];
                    const result2 = doraftStatus.reduce(function (accumulator, currentValue, index) {
                        if (currentValue != random) {
                            accumulator.push(index);
                        }
                        return accumulator;
                    }, [])
                    for (let i = 0; i < result2.length; i++) {
                        if (doraftStatus[result2[i]] !== "今回決定") {
                            doraftStatus[result2[i]] = "再指名";
                        }
                    }
                    doraftStatus[random] = "今回決定";
                }
                let count = 0;
                for (let i = 0; i < doraftStatus.length; i++) {
                    if (doraftStatus[i] === "再指名") {
                        count++;
                    }
                    RoomIDtoClientNum[socetIDtoInfo[socket.id].id] = count;
                }

                for (let i = 0; i < doraftStatus.length; i++) {
                    io.to(socetIDtoInfo[socket.id].id).emit('doraftedAlready', dorafthairetu[i]);
                    if (RoomIDtoClientNum[socetIDtoInfo[socket.id].id] === 0) {
                        //一巡終了
                        if (i == doraftStatus.length - 1) {
                            RoomIDtoClientNum[socetIDtoInfo[socket.id].id] = clients.length;
                        }
                        if (doraftStatus[i] === "今回決定") {
                            io.to(a[i].socketID).emit('determination', clients.length, dorafthairetu, a);
                        } else if (doraftStatus[i] === "再指名") {
                            io.to(a[i].socketID).emit('reDoraft', clients.length, dorafthairetu, a);
                        } else {
                            io.to(a[i].socketID).emit('already', clients.length, dorafthairetu, a);
                        }
                    } else {
                        if (doraftStatus[i] === "今回決定") {
                            io.to(a[i].socketID).emit('determination2', clients.length, dorafthairetu, a);
                        } else if (doraftStatus[i] === "再指名") {
                            io.to(a[i].socketID).emit('reDoraft2', clients.length, dorafthairetu, a);
                        } else {
                            io.to(a[i].socketID).emit('already2', clients.length, dorafthairetu, a);
                        }
                    }
                }

            }
        });
    });
});

http.listen(PORT, () => {
    console.log(`server listening. Port: ${PORT}`);
});

const createDoraftedListHTML = DoraftedList => {
    let str_ = "";
    DoraftedList.split(/\n/).forEach(str => {
        str_ += `<li>${str}</li>\n`;
    });
    return str_;
}

const createMemberListHTML = MemberList => {
    let str_ = "";
    MemberList.forEach(str => {
        str_ += `<li>${socetIDtoInfo[str].name}</li>`;
    });
    return str_;
}

const createMemberListHTML2 = MemberList => {
    let str_ = "<th></th>";
    MemberList.forEach(str => {
        str_ += `<th>${socetIDtoInfo[str].name}</th>`;
    });
    return str_;
}
