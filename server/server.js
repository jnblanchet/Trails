var express = require('express');
var app     = express();
var http    = require('http').Server(app);
var io      = require('socket.io')(http);
var config  = require('./config.json');
require('./gameConfig.js');
app.use(express.static(__dirname + '/../client'));
var b = require('./board.js');
var abilities = require('./abilities.js'); 
abilities = abilities.abilities;
var spawningQueue = require('./spawningQueue.js'); 
global.score = require('./score.js');

//
/** Game variables **/
//
global.users = []; // players and their data
var blocIdGenerator = 11;

//
/** Socket communication (game events) **/
//
//build socket event
global.sockets = {};
io.on('connection', function (socket) {
	console.log("A new player has connected: " + socket.id);
	sockets[socket.id] = socket;
	
	var spawnPosition = findGoodSpawn();
	var player = {
		id: socket.id,
		isDead: true,
		x: spawnPosition[0],
		y: spawnPosition[1],
		lastX: spawnPosition[0],
		lastY: spawnPosition[1],
		dx: spawnPosition[2],
		dy: spawnPosition[3],
		velocity: INITIAL_VELOCITY, // in blocs per second
		cooldown: TELE_COOLDOWN,
		maxCooldown: TELE_COOLDOWN,
		teleportDist: TELE_DISTANCE,
		pts: 1, // player points
		dpts: DEFAULT_POINTS_PER_SEC, // dpts/dt when you're positive
		lpr: DEFAULT_LOSING_POINTS_RATIO, // dpts/dt ratio factor when you're negative (stepping on own track)
		bonusSizeCache: 0, //use to cache the bonus size (so it is not recomputed constantly)
		hue: getUnusedColor(),
		lastHeartbeat: 0,
		name: '',
		blocId: blocIdGenerator,
		desyncCounter: 0, // the cumulated delta between client and server
		lastSlotFilled: 0,
		slots: Array.apply(null, Array(PU_SLOTS)).map(Number.prototype.valueOf,0),
		slotAggregation: Array.apply(null, Array(MAX_POWERUP_ID)).map(Number.prototype.valueOf,0),
		specialAbility: undefined
	};
	board.colorsLUT[player.blocId] = player.hue;
	blocIdLUT[blocIdGenerator] = player;
	blocIdGenerator++;
	
	users.push(player);
	
	function validNick(n) {
		var regex = /^\w?[ \w]{0,14}$/;
		return regex.exec(n) !== null;
	}

	socket.on('myNameIs', function (name) {
		if(!name || !validNick(name)){
			b.killPlayer(player, 'invalid name', 'Your name was invalid.'); 
			socket.disconnect();
		}
		player.name = name;
	});	
	
	spawningQueue.queuePlayer(player);

		
	socket.on('mv', function (newInfo) {
		//console.log('moving from ('+player.x+','+player.y+') to ('+newInfo.x+','+newInfo.y+') with delta ('+player.dx+','+player.dy+') and velocity '+player.velocity)
		if(!player.isDead) {
			player.dx = newInfo.dx;
			player.dy = newInfo.dy;
		
			// check if new position is reasonable. If sketchy, close socket.
			var serverTravelTime = (Math.abs(player.x - player.lastX) + Math.abs(player.y - player.lastY)) / player.velocity;
			var clientTravelTime = (Math.abs(newInfo.x - player.lastX) + Math.abs(newInfo.y - player.lastY)) / player.velocity;
			player.desyncCounter += serverTravelTime - clientTravelTime;
			
			var x = player.lastX, y = player.lastY;
			var nx = Math.round(newInfo.x), ny = Math.round(newInfo.y);
			player.lastHeartbeat = Date.now(); // see function checkHeartBeat
			player.x = newInfo.x;
			player.y = newInfo.y;
						
			if((nx <= 0 || ny <= 0 || nx >= board.W-1 || ny >= board.H-1)) {
				b.killPlayer(player, 'player is outside the playable area.','You crashed into a border.'); 
			} else if(nx != x || ny != y) { // if position has changed 
				playerBoard[x][y] = null; // update player position LUT
				playerBoard[nx][ny] = player;
				player.lastX = nx;
				player.lastY = ny;
				replayLine(x, y, nx, ny, player.blocId, player);
				//dilation(nx,ny,player,player.blocId); // this avoids a drawing glitch when turning quickly
			}
		}
	});

	socket.on('disconnect', function () {
		b.killPlayer(player, 'disconnected, killing his avatar', 'Connection was closed!');
		delete sockets[player.id];
		delete board.colorsLUT[player.blocId];
		var index = users.indexOf(player);
		if (index > -1){
            users.splice(index, 1);
			console.log('Player ' + player.name + ' disconnected!');
		}
    });
	
	socket.on('respawnRequest', function () {
		if(player.isDead) {
			var spawnPosition = findGoodSpawn();
			player.x = spawnPosition[0];
			player.y = spawnPosition[1];
			player.lastX = spawnPosition[0];
			player.lastY = spawnPosition[1];
			player.dx = spawnPosition[2];
			player.dy = spawnPosition[3];
			player.velocity = INITIAL_VELOCITY;
			spawningQueue.queuePlayer(player);
			score.updateLeaderboard(player);
		}
    });
	socket.on('teleport', function(x,y,dx,dy) {
		player.dx = dx; player.dy = dy;
		if(player.cooldown > 1 || player.dx == player.dy)
			b.killPlayer(player, 'used a powerup while still on CD', 'You were out of sync with the server :(');
		else if(Math.abs(Math.abs(x - player.x) + Math.abs(y - player.y) - player.teleportDist) > 4){ // a small lag grace
			console.log('Kicked player because teleport was off by ' + Math.abs(Math.abs(x - player.x) + Math.abs(y - player.y) - player.teleportDist) + ', which is greater than ' + 4);
			b.killPlayer(player, 'teleported way too far.', 'You were out of sync with the server :(');
		} else {
			player.x = x;
			player.y = y;
			player.lastX = Math.round(x);
			player.lastY = Math.round(y);
			teleportPlayer(player);
		}
	});
});
//set spawning logic
spawningQueue.setSpawnLogic(function(p) {
	p.hue = getUnusedColor(); // player is no longer part of any other hue groups!
	board.colorsLUT[p.blocId] = p.hue;
	p.isDead = false;
	p.lastHeartbeat = Date.now();
	sockets[p.id].emit('playerSpawn',{ // the player data
		id: p.blocId,
		x: p.x,
		y: p.y,
		dx:p.dx,
		dy:p.dy,
		velocity:p.velocity,
		hue: p.hue,
		cooldown: p.cooldown,
		pts: p.pts,
		dpts: p.dpts,
		lpr: p.lpr,
		maxCooldown: TELE_COOLDOWN,
		teleportDist: TELE_DISTANCE
	}, { // the board
		boardW:board.W,
		boardH:board.H,
		LOS:PLAYER_LOS_RANGE
	});
});
spawningQueue.setCountPlayersOnboard(function() {
	return users.filter(function(u) {return !u.isDead && sockets[u.id].connected}).length;
});

var serverPort = process.env.PORT || config.port;
http.listen(serverPort, function() {
	console.log("Server is listening on port " + serverPort);
});

//
/** Game state update functions **/
//
function moveloop(dt) {
	if (users.length > 0)
		users.forEach( function(u) {
			if(!u.isDead)
				movePlayer(u, dt);
		});
	// move other stuff here.
}
function gameloop() {
	dt = tick();
	
	moveloop(dt); // interpolate player position
	spawnPowerUps();
	//updateLinks(dt); // TODO: update all objects!
	// update cooldowns, scores and velocity
	users.forEach( function(u) {
		try{
			if (!u.isDead) {
				// cooldown
				u.cooldown = Math.max(0, u.cooldown - dt);
				// score
				//var dist = Math.abs(u.x - Math.round(u.x)) + Math.abs(u.y - Math.round(u.y)); // distance to nearest square
				updateBonusSize(u);
			}
		}catch(e){} // sometimes the player is outside and this causes a crash... it's not important.
	});	
}

var EMPTY_BLOCK = -1;
var SIDE_WALL = -2; // client side constants
function sendUpdatesBoard() {
	users.forEach( function(u) {
		if (!u.isDead) {
			// update walls
			var x = Math.round(u.x); var y = Math.round(u.y);
			losX0 = Math.max(x - PLAYER_LOS_RANGE,0);
			losX1 = Math.min(x + PLAYER_LOS_RANGE, board.W);
			losY0 = Math.max(y - PLAYER_LOS_RANGE,0);
			losY1 = Math.min(y + PLAYER_LOS_RANGE, board.H);
			var newBoard = {
				isBlock: null,
				colors: null,
				isPowerUp: null,
				x0: losX0,
				x1: losX1,
				y0: losY0,
				y1: losY1
			};
			if(losX1-losX0 >= 0 && losY1-losY0 > 0){ // sometimes players are outside, but not dead yet (not sure why)
				var colors = {};
				newBoard.blockId = new Array(losX1-losX0);
				newBoard.isPowerUp = new Array(losX1-losX0);
				for (var i=0;i<losX1-losX0;i++) {
					newBoard.blockId[i] = new Array(losY1-losY0);
					newBoard.isPowerUp[i] = new Array(losY1-losY0);
					for (var j=0;j<losY1-losY0;j++) {
						// this is for board and colors
						var id = board.blockId[i+losX0][j+losY0];
						newBoard.blockId[i][j] = EMPTY_BLOCK;
						var c = blocIdLUT[Math.abs(id)];
						if(c) {
							newBoard.blockId[i][j] = c.hue;
							colors[c.hue] = true;
						} else if (id == B_BORDERS) {
							newBoard.blockId[i][j] = SIDE_WALL;
						}
						// this is for power ups
						newBoard.isPowerUp[i][j] = board.isPowerUp[i+losX0][j+losY0];
					}
				}
				newBoard.colors = Object.keys(colors);

				sockets[u.id].emit('upBr', newBoard);
			}
		}
	});
}
function sendUpdatesPlayers() {
	users.forEach( function(u) {
		if (!u.isDead) {
			// update walls
			var x = Math.round(u.x); var y = Math.round(u.y);
			losX0 = Math.max(x - PLAYER_LOS_RANGE,0);
			losX1 = Math.min(x + PLAYER_LOS_RANGE, board.W-1);
			losY0 = Math.max(y - PLAYER_LOS_RANGE,0);
			losY1 = Math.min(y + PLAYER_LOS_RANGE, board.H-1);

			var otherPlayers = [];
			//var newLinks = [];
			//var l = board.links[u];
			/*if(l && l.dt >= LINK_START) {
				newLinks.push(toClientLink(l));
			}*/
			
			for (var i=0;i<=losX1-losX0;i++) {
				for (var j=0;j<=losY1-losY0;j++) {
					if(playerBoard[i+losX0][j+losY0]) {
						o = playerBoard[i+losX0][j+losY0];
						if(!o.isDead && o.id != u.id) {
							otherPlayers.push({
								id: o.blocId,
								x: o.x,
								y: o.y,
								dx:o.dx,
								dy:o.dy,
								velocity:o.velocity,
								hue: o.hue,
								name: o.name,
								pts: o.pts,
								dpts: o.dpts,
								slots: o.slots
							});
							/*l = board.links[otherPlayers];
							if(l && l.dt >= LINK_START) {
								newLinks.push(toClientLink(l));
							}*/
						}
					}
				}
			}
			var selfPlayer = {
				velocity:u.velocity,
				pts: u.pts,
				dpts: u.dpts,
				slots: u.slots
			};
							
			sockets[u.id].emit('upPl', otherPlayers, selfPlayer);
		}
	});
}

function toClientLink(serverLink) {
	return {
		x0: serverLink.fromP.x,
		y0: serverLink.fromP.y,
		x1: serverLink.toP.x,
		y1: serverLink.toP.y,
		progress: (serverLink.dt - LINK_START) / (LINK_END - LINK_START)
	};
}


/** Game Logic Helpers **/
var lastUpdate = Date.now(); // used to compute the time delta between frames
function tick() { // handles the delta time between frames
    var now = Date.now();
    var dt = now - lastUpdate;
    lastUpdate = now;
	
	return dt / 1000;
}

function movePlayer(p, dt) {
	p.x += p.dx * p.velocity * dt;
	p.y += p.dy * p.velocity * dt;
	var x = Math.round(p.x-p.dx*.5), y = Math.round(p.y-p.dy*.5);
	if((x > 0 && y > 0 && x < board.W-1 && y < board.H-1)) {
		if (board.blockId[x][y] == B_EMPTY) {
			board.blockId[x][y] = p.blocId * -1; // spawn "phantom" trail
			board.BlockTs[x][y] = lastUpdate;
		}
		afterInterpolationMove(x,y,p);
	}
}

function replayLine(x0, y0, x1, y1, v, p) { //also checks for collision (and possibly kills p)
	try {
		var now = Date.now();
		var dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
		if(!(dx == 0 ^ dy == 0)) return; // some weird lag happened? avoid infinite loop.
		
		while((x0!=x1) || (y0!=y1)) {
			beforeConfirmedMove(x0,y0,p);
			if(board.blockId[x0][y0] == B_EMPTY || board.blockId[x0][y0] == (p.blocId * -1)) { // fill empty cells or "phantom" trail from interpolation
				board.blockId[x0][y0] = v;
				board.BlockTs[x0][y0] = now;
				dilation(x0,y0,p,p.blocId);
			} else if(p && board.colorsLUT[board.blockId[x0][y0]] != p.hue && board.blockId[x0][y0] > B_KILLSYOUTHRESHOLD && now - board.BlockTs[x0][y0] >= WALL_SOLIDIFICATION) { // kill if needed
				if(p.specialAbility && p.specialAbility.onPlayerWallHit)
					if(p.specialAbility.onPlayerWallHit(x0,y0,p))
						break;
				b.hasCrashedInto(blocIdLUT[board.blockId[x0][y0]], p);
				break; // weather he died or not, we still stop drawing the line (this could change in the future with new abilities)
			}
			x0 += dx;
			y0 += dy;
		}
	} catch(err) {
		console.log('fail to draw line at ' + x0 + ',' + y0 + ':' + err);
	}
}

function afterInterpolationMove(x,y,p) {
	// check for powerups pickup
	var s = Math.floor(p.bonusSizeCache);
	
	var x0 = Math.max(x - s,0);
	var x1 = Math.min(x + s, board.W-1);
	var y0 = Math.max(y - s,0);
	var y1 = Math.min(y + s, board.H-1);
	//try {
		for(i=x0;i<=x1;i++)
			for(j=y0;j<=y1;j++)
				if(board.isPowerUp[i][j] != PU_ID_NONE) {
					var id = board.isPowerUp[i][j];
					board.isPowerUp[i][j] = PU_ID_NONE;
					board.numPowerUpsOnBoard--;
					pickupPowerUp(p, id);
				}					
	//catch(x){} // too lazy to check limits
		

	//console.log('added phantom with value ' + board.blockId[x][y] + ' at posistion (' + x + ',' + y + ') for player #' + p.blocId);
	dilation(x,y,p,p.blocId * -1);
	
	if(p.specialAbility && p.specialAbility.onChangePosition)
		p.specialAbility.onChangePosition(x,y,p);
}

function beforeConfirmedMove(x,y,p) {
	// update points
	
	if(board.blockId[x][y]*-1 != p.id && board.colorsLUT[board.blockId[x][y]] == p.hue && now - board.BlockTs[x][y] >= 2000/p.velocity) { // this is 1000 ms / speed (with a little wiggle room)
		//console.log('removing pts, isnotselfInterp=' + (board.blockId[x][y]*-1 != p.id) + ', colorChk=' + (board.colorsLUT[board.blockId[x][y]] == p.hue) + ', dt=' + (now - board.BlockTs[x][y]) +'ms');
		p.pts += (p.dpts*p.lpr) / p.velocity;
		//console.log('--');
	} else {
		p.pts += p.dpts / p.velocity;
		//console.log('++');
	}
	if(p.pts <= 0)
		b.killPlayer(p,'ran out of points', 'You lost all your points! Avoid your own track next time.');
	// update velocity based on points
	p.velocity = INITIAL_VELOCITY / (0.000071 * p.pts + 1) + p.slotAggregation[PU_ID_SPEED-1] * PU_SPEED_MOD; // at 10k pts, speed = 7
}

function dilation(x,y,p,v) {
	// make the line fatter
	var s = Math.floor(p.bonusSizeCache);
	var initVal = 0;
	if (s > 0) {
		var x0 = Math.max(x - s,0);
		var x1 = Math.min(x + s, board.W - 1);
		var y0 = Math.max(y - s,0);
		var y1 = Math.min(y + s, board.H - 1);
		for(i=x0;i<=x1;i++)
			for(j=y0;j<=y1;j++) {
				initVal = board.blockId[i][j]
				if (initVal <= B_EMPTY && initVal != v) {
					board.blockId[i][j] = v;
					board.BlockTs[i][j] = board.BlockTs[x][y];
				}
			}
	}
}

function updateBonusSize(p) {
	p.bonusSizeCache = Math.pow(p.pts/1000,0.333333);
}

// returns a position and direction [x y dx dy] to spawn
function findGoodSpawn() {
	var x,y,dx,dy;
	var goodSpawn = false;
	do {
		x = getRandomInt(SPAWN_SPACE_NEEDED,board.W - SPAWN_SPACE_NEEDED);
		y = getRandomInt(SPAWN_SPACE_NEEDED,board.H - SPAWN_SPACE_NEEDED);
		dx = getRandomInt(0,1)*2 - 1;
		dy = 0;
		if(getRandomInt(0,1) == 0) { // sometimes use y
			dy = dx; dx = 0;
		}
		goodSpawn = true;
		for (var i=0;i<SPAWN_SPACE_NEEDED;i++){ // at least n squares to move forwards
			if(board.blockId[x+dx*i][y+dy*i] > B_EMPTY){
				goodSpawn = false;
				break;
			}
		}
	} while(!goodSpawn);
	console.log('Spawning player at ' + x +',' + y + ' with direction ' + dx + ',' + dy);
	return [x,y,dx,dy];
}

function spawnPowerUps() {
	if(board.numPowerUpsOnBoard < NUM_POWERUPS_ONBOARD) {
		var x = getRandomInt(1,board.W - 2); // cannot spawn on borders
		var y = getRandomInt(1,board.H - 2);
		if(board.blockId[x][y] == B_EMPTY && !board.isPowerUp[x][y] && !playerBoard[x][y]) {
			board.isPowerUp[x][y] = getRandomInt(1,MAX_POWERUP_ID);
			board.numPowerUpsOnBoard++;
		}
	}
}

function cleanPhantomTrails() {
	for (var i=1;i<board.W-1;i++) {
		for (var j=1;j<board.H-1;j++) {
			if(board.blockId[i][j] < B_BORDERS * -1 && lastUpdate - board.BlockTs[i][j] >= 1000) { //phantom trails should last this long
				board.blockId[i][j] = B_EMPTY;
			}
		}
	}
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function teleportPlayer(player) {
	player.cooldown = player.maxCooldown;
	var r = TELE_CLEAR_RADIUS + player.slotAggregation[PU_ID_TELEAOE-1] * PU_TELE_AOE;
	b.clearAroundPoint(player.x,player.y,r);
	
	if(player.specialAbility && player.specialAbility.onTeleportLanding)
		player.specialAbility.onTeleportLanding(player.x,player.y,player);
}

var now;
function checkHeartBeat() {
	now = Date.now();
    var dt = now - lastUpdate;
	
		users.forEach( function(u) {
			if(!u.isDead)
				if(now - u.lastHeartbeat >= MAX_HEARTBEAT_KICK)
					b.killPlayer(u, 'no hearthbeat received for more than ' + MAX_HEARTBEAT_KICK, 'You lagged out :(');
		});
}

function pickupPowerUp(player, powerUpType) {
	player.slots[player.lastSlotFilled] = powerUpType;
	player.lastSlotFilled = (player.lastSlotFilled + 1) % PU_SLOTS;
	for(var i =0;i<MAX_POWERUP_ID ;i++)
		player.slotAggregation[i] = PU_ID_NONE;
	
	for(var i =0;i<PU_SLOTS ;i++)
		if(player.slots[i] > 0)
			player.slotAggregation[player.slots[i]-1]++;
		
	// cache some stuff
	player.maxCooldown = TELE_COOLDOWN - player.slotAggregation[PU_ID_TELECD-1] * PU_TELE_CD;
	player.dpts = DEFAULT_POINTS_PER_SEC + player.slotAggregation[PU_ID_POINTS-1] * PU_POINTS_MOD ;
	player.teleportDist = TELE_DISTANCE + player.slotAggregation[PU_ID_TELERANGE-1] * PU_TELE_RANGE;
	player.lpr = DEFAULT_LOSING_POINTS_RATIO - player.slotAggregation[PU_ID_PTSLOSS-1] * PU_PTS_LOSS_MOD;
	
	sockets[player.id].emit('newVals', {
		maxCooldown: player.maxCooldown,
		dpts: player.dpts,
		lpr: player.lpr,
		teleportDist: player.teleportDist
	});
	
	// update ability
	player.specialAbility = abilities.find( function(a) {
		for(var i=0;i<MAX_POWERUP_ID;i++)
			if(player.slotAggregation[i] != a.recipe[i])
				return false;
		return true;
	});
	
	if(player.specialAbility)
		sockets[player.id].emit('newAbility', player.specialAbility.description);
	else
		sockets[player.id].emit('newAbility', '');
}

// this function kicks players that are out of synch with the game clock.
function checkSync() {
	users.forEach( function(u) {
		if(!u.isDead)
			if(Math.abs(u.desyncCounter) > MAX_DESYNC_TOLERENCE) {
				//console.log('Kicked player because desync was ' + u.desyncCounter + ', which is greater than ' + MAX_DESYNC_TOLERENCE);
				//b.killPlayer(u, 'desync too high', 'You were out of sync with the server :('); // TODO: force resync
				forceResync(u);
				console.log('Forced resync with ' + u.name + ' because desync was ' + u.desyncCounter + ', which is greater than ' + MAX_DESYNC_TOLERENCE);
			}
	});
}

// this function is called when a player sends data inconsistent with the server values. The server forces a resync with the client.
function forceResync(p) {
	sockets[p.id].emit('sync',p.x,p.y);
	p.desyncCounter = 0;
}

function getUnusedColor() {
	if(users.length >= 35) // there aren't any free colors.
		return Math.round(Math.random() * 35) * 10;
	
	var blackList = new Array(360);
	
	board.colorsLUT.forEach( function(c) {
		blackList[c] = true;
	});
	
	do {
		c = Math.round(Math.random() * 35) * 10;
	} while(blackList[c]);
	return c;
	
}


/** Launch game **/
setInterval(gameloop, 1000/15);
setInterval(sendUpdatesBoard, 1000 / 15);
setInterval(sendUpdatesPlayers, 1000 / 15);
setInterval(checkHeartBeat, 2000);
setInterval(checkSync, 500); // security function
setInterval(cleanPhantomTrails, 1000);

