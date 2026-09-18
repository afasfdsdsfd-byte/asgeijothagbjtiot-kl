const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let rooms = {};

// public 폴더 안의 index.html을 정적 파일로 제공
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('유저 접속:', socket.id);

    // 방 목록 요청
    socket.on('getRooms', () => {
        socket.emit('roomList', Object.values(rooms));
    });

    // 방 만들기
    socket.on('createRoom', () => {
        const roomId = 'room_' + Math.random().toString(36).substring(2, 7);
        rooms[roomId] = {
            id: roomId,
            name: `방 #${roomId.substring(5)}`,
            players: {},
            started: false
        };

        rooms[roomId].players[socket.id] = {
            id: socket.id,
            team: 'RED',
            hp: 500,
            charId: 0,
            selected: false,
            isDead: false,
            x: 0, z: 0
        };

        socket.join(roomId);
        socket.emit('roomJoined', { roomId, players: rooms[roomId].players, myId: socket.id });
        io.emit('roomList', Object.values(rooms));
    });

    // 방 참가하기
    socket.on('joinRoom', (roomId) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', '존재하지 않는 방입니다.');
        if (room.started) return socket.emit('errorMsg', '이미 게임이 시작된 방입니다.');

        const count = Object.keys(room.players).length;
        const team = count % 2 === 0 ? 'RED' : 'BLUE';

        room.players[socket.id] = {
            id: socket.id,
            team: team,
            hp: 500,
            charId: 0,
            selected: false,
            isDead: false,
            x: 0, z: 0
        };

        socket.join(roomId);
        socket.emit('roomJoined', { roomId, players: room.players, myId: socket.id });
        io.to(roomId).emit('updateRoomState', { players: room.players });
        io.emit('roomList', Object.values(rooms));
    });

    // 캐릭터 선택
    socket.on('selectChar', ({ roomId, charId }) => {
        const room = rooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].charId = charId;
            room.players[socket.id].selected = true;

            io.to(roomId).emit('updateRoomState', { players: room.players });

            // 모든 유저가 선택했으면 게임 시작
            const playerList = Object.values(room.players);
            if (playerList.length > 0 && playerList.every(p => p.selected)) {
                room.started = true;
                io.to(roomId).emit('startGame', { players: room.players });
                io.emit('roomList', Object.values(rooms));
            }
        }
    });

    // 플레이어 이동
    socket.on('move', ({ roomId, x, z }) => {
        if (rooms[roomId] && rooms[roomId].players[socket.id]) {
            rooms[roomId].players[socket.id].x = x;
            rooms[roomId].players[socket.id].z = z;
            socket.to(roomId).emit('playerMoved', { id: socket.id, x, z });
        }
    });

    // 투사체 발사 (공격)
    socket.on('shoot', ({ roomId, bulletData }) => {
        socket.to(roomId).emit('playerShot', bulletData);
    });

    // 피격 및 데미지 계산
    socket.on('takeDamage', ({ roomId, targetId, damage, attackerId }) => {
        const room = rooms[roomId];
        if (room && room.players[targetId]) {
            const target = room.players[targetId];
            target.hp = Math.max(0, target.hp - damage);
            if (target.hp === 0) target.isDead = true;

            io.to(roomId).emit('hpUpdated', { id: targetId, hp: target.hp, isDead: target.isDead });
            io.to(attackerId).emit('hitConfirmed');

            // 승패 조건 확인
            let redAlive = 0, blueAlive = 0;
            Object.values(room.players).forEach(p => {
                if (!p.isDead) {
                    if (p.team === 'RED') redAlive++;
                    if (p.team === 'BLUE') blueAlive++;
                }
            });

            if (redAlive === 0 || blueAlive === 0) {
                const winner = redAlive > 0 ? 'RED' : 'BLUE';
                io.to(roomId).emit('gameOver', { winnerTeam: winner });
            }
        }
    });

    // 퇴장
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            if (rooms[roomId].players[socket.id]) {
                delete rooms[roomId].players[socket.id];
                if (Object.keys(rooms[roomId].players).length === 0) {
                    delete rooms[roomId];
                } else {
                    io.to(roomId).emit('updateRoomState', { players: rooms[roomId].players });
                }
                io.emit('roomList', Object.values(rooms));
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`🎮 실시간 멀티플레이 서버 실행 중! (포트: ${PORT})`);
    console.log(`=================================================`);
});
