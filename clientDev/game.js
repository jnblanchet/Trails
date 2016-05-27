function Game() { };
//
/** Game loops **/
//
Game.prototype.handleNetwork = function(socket) {
	socket.emit('myNameIs', playerName);
	
	var c = document.getElementById('cvs');
	c.width = screenWidth; c.height = screenHeight;
	bindKeyboard(c);
	bindClickTap(c);
	// This is where all socket messages are received
	socket.on('playerSpawn', function (newPlayer, board) {
		initBoard(board.boardW,board.boardH);
		player = newPlayer;
		player['name'] = playerName; // in case myNameIs hasn't registered yet

		gameOver = false;
		tick();
	});
	
	socket.on('updateBoard', function (newBoard) {
		for (var i=newBoard.x0;i<newBoard.x1;i++) {
			for (var j=newBoard.y0;j<newBoard.y1;j++) { // update xp and board
				board.isXp[i][j] = newBoard.isXp[i-newBoard.x0][j-newBoard.y0];
				/*if(player.lastPos && player.lastPos[0] == i && player.lastPos[1] == j) // never update last pos, client is always right
					continue;*/
				board.isBloc[i][j] = newBoard.isBloc[i-newBoard.x0][j-newBoard.y0]; 
			}
		}
		// overide with short term client knowledge (to avoid flicker)
		lastFewBlocs.forEach( function(p) {
			board.isBloc[p[0]][p[1]] = player.hue;
		});
		colors = newBoard.colors;
	});
	
	socket.on('updatePlayers', function (updatedPlayers, newLinks) {
		// We keep some local values (x,y) because they're more reliable than server values (because of lag)
		updatedPlayers.forEach( function(p) {
			if(otherPlayers)
				for ( var i=0; i < otherPlayers.length; i++ ) {
					var o = otherPlayers[i];
					if (o.name === p.name && o.hue === p.hue) { // if it's the same dude?
						if(o.dx == p.dx && o.dy == p.dy) { // if the direction hasn't changed
							if(Math.abs(o.x - p.x) + Math.abs(o.y - p.y) < (Math.abs(o.dx) + Math.abs(o.dy)) * o.velocity * 0.1) {
								// keep the old values if the delta is small (to avoid jitter)
								p.x = otherPlayers[i].x;
								p.y = otherPlayers[i].y;
							}
						}
						break;
					}
				}
		});
		otherPlayers = updatedPlayers;
		links = newLinks;
	});
	
	socket.on('playerDied', function () {
		gameOver = true;
		lastFewBlocs = [];
		lastFewBlocsId = 0;
	});
	
	socket.on('newSpeed', function (v) {
		player.velocity = v;
	});
	
	socket.on('newHue', function (v) {
		player.hue = v;
	});

	socket.on('updateLeaderBoard', function (leaderBoard) {
		displayLeaderBoard(leaderBoard);
	});	
}

Game.prototype.handleLogic = function() {
	if (!player || gameOver) // the game hasn't initialized yet!
		return;
		
	// move player
	var dt = tick();
	var isNewBloc = movePlayer(player, dt);
	if(isNewBloc) {
		socket.emit('playerMove', {x:player.x, y:player.y});
		if(player.lastPos) { // this queue remembers last few values to reduce flicker from client-server disagreement
			lastFewBlocs[lastFewBlocsId] = player.lastPos;
			lastFewBlocsId = (lastFewBlocsId+1) % FEW_BLOCS_SIZE;
		}
		
	}
	updatePlayerDirection();
	if (otherPlayers)
		otherPlayers.forEach( function(o) {
			movePlayer(o, dt);
		});
	// update cooldown
	player.cooldown = Math.max(0, player.cooldown - dt);
}

Game.prototype.handleGraphics = function(gfx) {
	if (!player) // the game hasn't initialize yet!
		return;
		
	// This is where you draw everything
	gfx.fillStyle = '#fbfcfc';
	gfx.fillRect(0, 0, screenWidth, screenHeight);
	
	if(gameOver) {
		gfx.fillStyle = '#2ecc71';
		gfx.strokeStyle = '#27ae60';
		gfx.font = 'bold 50px Verdana';
		gfx.textAlign = 'center';
		gfx.lineWidth = 2;
		gfx.fillText('G A M E  O V E R', screenWidth * 0.5, screenHeight * 0.4);
		gfx.strokeText('G A M E  O V E R', screenWidth * 0.5, screenHeight * 0.4);
		gfx.font = 'bold 25px Verdana';
		gfx.fillText('press space bar to respawn...', screenWidth * 0.5, screenHeight * 0.7);
		gfx.strokeText('press space bar to respawn...', screenWidth * 0.5, screenHeight * 0.7);
		return;
	}

	// draw board
	drawBoard(gfx);
	
	// draw players
	drawPlayer(gfx, player);
	if (otherPlayers)
		otherPlayers.forEach( function(o) {
			drawPlayer(gfx, o);
		});
	// drawLinks
	drawLinks(gfx);
	
	//draw cooldown marker
	if(player.cooldown > 0) {
		var bx = screenWidth * 0.5 - HALF_BLOC_SIZE_DISPLAY*.8,
			by = screenHeight * 0.5 - HALF_BLOC_SIZE_DISPLAY*1.5;
		var ex = screenWidth * 0.5 + HALF_BLOC_SIZE_DISPLAY*.8,
			ey = by;
		gfx.strokeStyle = '#000';
		gfx.lineWidth = 10;
		gfx.beginPath();
		gfx.moveTo(bx,by);
		gfx.lineTo(ex,ey);
		gfx.stroke();
		
		ex = bx + (ex-bx)*(1 - (player.cooldown / player.maxCooldown));
		gfx.strokeStyle = '#fff';
		gfx.lineWidth = 8;
		gfx.beginPath();
		gfx.moveTo(bx,by);
		gfx.lineTo(ex,ey);
		gfx.stroke();
		
		/*gfx.fillStyle = '#fff';
		gfx.font = 'bold 12px Verdana';
		gfx.fillText(Math.ceil(player.cooldown), screenWidth * 0.5, screenHeight * 0.5);*/
	}
}

//
/** Game logic variables **/
//
var player = null;
var otherPlayers = null;
var board = {
	H: 0,
	W: 0,
	isBloc: null,
	isXp: null
};
var colors = []; // contains all colors to be drawn, received from server.
var links = [];
var lastFewBlocs = []; //client will always trust itself for board state of these pts
var lastFewBlocsId = 0; var FEW_BLOCS_SIZE = 5;
var lastUpdate = Date.now(); // used to compute the time delta between frames

function initBoard(H,W){
	// Board
	board.W = W;
	board.H = H;
	board.isBloc = new Array(W);
	board.isXp = new Array(W);
	for (var i=0;i<W;i++) {
		board.isBloc[i] = new Array(H);
		board.isXp[i] = new Array(H);
		for (var j=0;j<H;j++) {
			board.isBloc[i][j] = EMPTY_BLOC;
			board.isXp[i][j] = false;
		}
	}
}
var gameOver = false;

//
/** Game drawing constants **/
//
var HALF_BLOC_SIZE_DISPLAY = 18; // the left and right padding in px when drawing a bloc
var BLOC_TO_PIXELS = 36; // the size of a game bloc
var BLOC_COLOR = '#777';
var XP_RADIUS = 10;
var XP_STROKE = 3;
var XP_COLOR = '#9900ff';
var XP_SCOLOR = '#000066';
var LINK_COLOR = '#99ccff';
var LINK_SCOLOR = '#00264d';
var LINK_INNER = 7;
var LINK_OUTER = 15;
var LINK_JITTER = 5; // adds a jitter effect (in px)
//
/** Game logic constants **/
//
var EMPTY_BLOC = -1;
var SIDE_WALL = -2;

//
/** Game logic helpers **/
//
function tick() { // handles the delta time between frames
    var now = Date.now();
    var dt = now - lastUpdate;
    lastUpdate = now;
	
	return dt / 1000;
}

function updatePlayerDirection() {
	
	if(lastDirectionPressed == NO_KEY) // player does not want to switch direction
		return;
	
	// one of these two will be zero of very close, since player is always moving along the grid
	delta = (player.x - turnPosition[0]) * player.dx
			+ (player.y - turnPosition[1]) * player.dy;

	if(delta < 0) // if the distance between the player and the next valid turning position is negative, we haven't reached the turn point yet
		return;
		
	player.x = Math.round(player.x);
	player.y = Math.round(player.y);
	
	if (lastDirectionPressed == KEY_LEFT && player.dx == 0) {
		changePlayerDirection(-1.0,0.0);
	} else if (lastDirectionPressed == KEY_RIGHT && player.dx == 0) {
		changePlayerDirection(1.0,0.0);
	} else if (lastDirectionPressed == KEY_DOWN && player.dy == 0) {
		changePlayerDirection(0.0,1.0);
	} else if (lastDirectionPressed == KEY_UP && player.dy == 0) {
		changePlayerDirection(0.0,-1.0);
	}
	// if we had a delta, adjust according to the new direction
	player.x += player.dx * (delta);
	player.y += player.dy * (delta);
	lastDirectionPressed = comboDirectionPressed;
	comboDirectionPressed = NO_KEY;
	updateTurnTargetPosition();
}

function changePlayerDirection(x,y) {
	player.dx = x;
	player.dy = y;
	socket.emit('directionChange',{dx:player.dx, dy:player.dy});
}

// player position update. returns true if the bloc has changed.
function movePlayer(p, dt) {
	p.x += p.dx * p.velocity * dt;
	p.y += p.dy * p.velocity * dt;
	var squareX = Math.round(p.x - p.dx*.5), squareY = Math.round(p.y - p.dy*.5);
	squareX = Math.min(Math.max(squareX,0),board.W-1);
	squareY = Math.min(Math.max(squareY,0),board.H-1);
	board.isBloc[squareX][squareY] = p.hue;
		
	// check if it's a new value
	var value = false;
	if (p.lastPos && (p.lastPos[0] != squareX || p.lastPos[1] != squareY)) {
		value = true;
	}
	p.lastPos = [squareX, squareY];
	
	return value;
}

//
/** Display helpers **/
//
function drawPlayer(gfx, p){	
	gfx.fillStyle = 'hsl(' + p.hue + ', 100%, 50%)';
	gfx.strokeStyle =  'hsl(' + p.hue + ', 90%, 40%)';
	gfx.lineWidth = 5;
	gfx.lineJoin = 'round';
	gfx.lineCap = 'round';
	var coords = getBlocDrawCoordinates(p.x,p.y,HALF_BLOC_SIZE_DISPLAY);
	gfx.fillRect(coords[0],coords[1],coords[2],coords[3]);
	gfx.strokeRect(coords[0],coords[1],coords[2],coords[3]);
	
	// draw name
	gfx.fillStyle = 'hsl(' + p.hue + ', 100%, 90%)';
	gfx.strokeStyle =  'hsl(' + p.hue + ', 90%, 40%)';
	gfx.font = 'bold 50px Verdana';
	gfx.textAlign = 'center';
	gfx.lineWidth = 2;
	coords = boardToScreen(p.x,p.y-1);
	gfx.fillText(p.name, coords[0], coords[1]);
	gfx.strokeText(p.name, coords[0], coords[1]);
}

function drawBoard(gfx){
	// figure out how much can be seen by the player
	LosW = screenWidth / 2 / BLOC_TO_PIXELS;
	LosH = screenHeight / 2 / BLOC_TO_PIXELS;
	LosX0 = Math.round(Math.max(player.x - LosW,0));
	LosX1 = Math.round(Math.min(player.x + LosW, board.W-1));
	LosY0 = Math.round(Math.max(player.y - LosH,0));
	LosY1 = Math.round(Math.min(player.y + LosH, board.H-1));

	for (var c=-1; c < colors.length; c++) {
		// set brush color and target id
		var targetC;
		if (c == -1) { // first loop is for edges
			targetC = SIDE_WALL;
			gfx.fillStyle = BLOC_COLOR;
		} else {
			targetC = colors[c];
			gfx.fillStyle = 'hsl(' + targetC + ', 50%, 80%)';
		}
		
		var pad = HALF_BLOC_SIZE_DISPLAY*2;
		var sY=0, sX = Math.round(BLOC_TO_PIXELS*(LosX0 - player.x) + screenWidth /2 ) - HALF_BLOC_SIZE_DISPLAY;
		for (var i=LosX0;i<=LosX1;i++) {
			sY = Math.round(BLOC_TO_PIXELS*(LosY0 - player.y) + screenHeight /2 ) - HALF_BLOC_SIZE_DISPLAY;
			for (var j=LosY0;j<=LosY1;j++) {
				if (board.isBloc[i][j] == targetC){
					gfx.fillRect(sX,sY,pad,pad);
				}
				sY += BLOC_TO_PIXELS;
			}
			sX += BLOC_TO_PIXELS;
		}
	}
	// draw xp
	gfx.fillStyle = XP_COLOR;
	gfx.strokeStyle = XP_SCOLOR;
	gfx.lineWidth = XP_STROKE;
	var PI2 = 2*Math.PI;
	var sY=0, sX = Math.round(BLOC_TO_PIXELS*(LosX0 - player.x) + screenWidth /2 );
	for (var i=LosX0;i<=LosX1;i++) {
		sY = Math.round(BLOC_TO_PIXELS*(LosY0 - player.y) + screenHeight /2 );
		for (var j=LosY0;j<=LosY1;j++) {
			if (board.isXp[i][j]) {
				gfx.beginPath();
				gfx.arc(sX,sY,XP_RADIUS,0,PI2);
				gfx.fill();
				gfx.stroke();
			}
			sY += BLOC_TO_PIXELS;
		}
		sX += BLOC_TO_PIXELS;
	}
}

function drawLinks(gfx) {
	if(links)
		links.forEach( function(l) {
			// compute line coords
			var s = boardToScreen(l.x0,l.y0,true);
			var x1 = l.x0 + (l.x1 - l.x0) *(1.6 * l.progress),
				y1 = l.y0 + (l.y1 - l.y0) * (1.6 * l.progress);
			var e = boardToScreen(x1,y1,true);
			
			var pts = new Array(22);
			var w = 0.0;
			for(var i=0; i<=20; i+=2) {
				pts[i] = s[0] + (e[0] - s[0]) * w + getRandomInt(-1 * LINK_JITTER, LINK_JITTER);
				pts[i+1] = s[1] + (e[1] - s[1]) * w + getRandomInt(-1 * LINK_JITTER, LINK_JITTER);
				w += 0.05;
			}
			
			// draw outer line
			gfx.strokeStyle = LINK_SCOLOR;
			gfx.lineWidth = LINK_OUTER;
			gfx.beginPath();
			gfx.moveTo(pts[0],pts[1]);
			for(var i=2; i<pts.length; i+=2) {
				gfx.lineTo(pts[i],pts[i+1]);
			}
			gfx.stroke();
			
			// draw inner line
			gfx.strokeStyle = LINK_COLOR;
			gfx.lineWidth = LINK_INNER;
			gfx.beginPath();
			gfx.moveTo(pts[0],pts[1]);
			for(var i=2; i<pts.length; i+=2) {
				gfx.lineTo(pts[i],pts[i+1]);
			}
			gfx.stroke();
		});
}

function usePowerup() {
	if(player && player.cooldown == 0) {
		var tx = Math.round(player.x + player.dx * player.teleportDist);
		var ty = Math.round(player.y + player.dy * player.teleportDist);
		
		if(tx > 1 && ty > 1 && tx < board.W-2 && ty < board.H-2) {
			player.x = tx;
			player.y = ty;
			socket.emit('powerupUsed',tx, ty);
			// TODO: draw a big red circle (explosion) on land
			player.cooldown = player.maxCooldown;
			clearFutureTurns(); // this is necessary, otherwise player goes nuts
		}
	}
}

function displayLeaderBoard(leaderboard) {
	var status = '<h1>Leaderboard</h1>';
	i = 1;
	if(leaderboard)
		leaderboard.forEach( function(l) {
			status += '<br />';
			status += '<span style="float:left">' + (i++) + '. ' + l.name + '</span>&nbsp;&nbsp;&nbsp;' + '<span style="float:right">' + l.score + '</span>';
		});
	document.getElementById('status').innerHTML = status;
}

function boardToScreen(x,y,isfloat){
	if(isfloat)
		return [
			BLOC_TO_PIXELS*(x - player.x) + screenWidth /2,
			BLOC_TO_PIXELS*(y - player.y) + screenHeight /2
		];
	else
		return [
			Math.round(BLOC_TO_PIXELS*(x - player.x) + screenWidth /2 ),
			Math.round(BLOC_TO_PIXELS*(y - player.y) + screenHeight /2 )
		];
}

function getBlocDrawCoordinates(x,y,size){
	var screenPos = boardToScreen(x,y);
	return [
		screenPos[0] - size,
		screenPos[1] - size,
		size*2,
		size*2
	];
}

/** Keyboard handling **/
var KEY_LEFT = 37;
var KEY_UP = 38;
var KEY_RIGHT = 39;
var KEY_DOWN = 40;
var KEY_SPACE = 32;
var NO_KEY = -1;

var TAP_CENTER_REL_DIST = 0.05;
function bindClickTap(c) {
	c.addEventListener('click', function(event) {
		// figure out where the tap happened
		var w2 = screenWidth/2,
			h2 = screenHeight/2;
		var rx = event.x-w2,
			ry = h2-event.y;
		if(Math.sqrt(rx*rx+ry*ry) <= screenWidth * TAP_CENTER_REL_DIST)
		{
			if(gameOver) // SPACE BAR LOGIC
				socket.emit('respawnRequest', playerName);
			else if(!gameOver)
				usePowerup();
			return;
		}
		
		var key = null;
		var deg = 180 * Math.atan2(rx, ry) / Math.PI;
		if(deg < -135 || deg > 135)
			key = KEY_DOWN;
		else if(deg < -45)
			key = KEY_LEFT;
		else if(deg > 45)
			key = KEY_RIGHT;
		else
			key = KEY_UP;

		applyKeyboardDirectionLogic(key);
	}, false);
}

function bindKeyboard(c) {
	c.addEventListener('keydown', directionDown, false);
}

var lastDirectionPressed = NO_KEY;
var comboDirectionPressed = NO_KEY;
function directionDown(event) {
	var key = event.which || event.keyCode;
	if (key == KEY_LEFT || key == KEY_RIGHT || key == KEY_DOWN || key == KEY_UP) {
		applyKeyboardDirectionLogic(key);
	} else if(key == KEY_SPACE) {
		if(gameOver)
			socket.emit('respawnRequest', playerName);
		else if(!gameOver)
			usePowerup();
	}
}

function applyKeyboardDirectionLogic(key) {
	if(!gameOver) {
		if(lastDirectionPressed == NO_KEY) {
			lastDirectionPressed = key;
			updateTurnTargetPosition();
		} else {
			comboDirectionPressed = key;
		}
	}
}

function clearFutureTurns() {
	turnPosition = [0,0];
	lastDirectionPressed = NO_KEY;
	comboDirectionPressed = NO_KEY;
}
var turnPosition = [0,0];
function updateTurnTargetPosition() {
	turnPosition[0] = Math.round(player.x + player.dx/2);
	turnPosition[1] = Math.round(player.y + player.dy/2);
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}