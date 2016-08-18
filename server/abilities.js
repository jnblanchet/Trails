// this file contains the definition for all abilities
// this is the ordering (for reference only) : purple, yellow, blue, green, red, orange
// the functions that may be defined for each ability are:
// onTeleportLanding(x,y,p)
// onLinkComplete(A,B)
// onPlayerWallHit(x,y,p) // returns true if player lives, false if he dies
// onChangePosition(x,y,p)
// afterCacheStatsLogic(p)
// teleportOverride(p)
var b = require('./board.js');
var objects = require('./gameObject.js');


module.exports = {
  abilities: [
		{
			name: 'Point Vacuum',
			description: 'After teleporting, you channel a ray on a nearby player in attempt to steal a large number of points.',
			recipe: [0,0,0,2,2,0], // purple, yellow, blue, green, red, orange
			onTeleportLanding: function(x,y,p) {
				const POINTS_VAC_STEAL_RATIO = 0.50; // the ratio of points stolen
				var nearestPlayer = b.findNearestPlayer(x,y,8,p);
				
				if(nearestPlayer != null)  // create link if possible
					objects.createLink(p, nearestPlayer, 1.5, 10, 2);
			},
			onLinkComplete: function(A,B) {
				var ptsLoss = B.pts * POINTS_VAC_STEAL_RATIO;
				B.pts -= ptsLoss;
				A.pts += ptsLoss;
			}
		},
		{
			name: 'Safe Landing',
			description: 'Your teleport clearing effect now also removes power ups in a large area.',
			recipe: [4,0,0,0,0,0], // purple, yellow, blue, green, red, orange
			onTeleportLanding: function(x,y,p) {
				const LANDING_CLEAR_RADIUS = 8;
				b.applyLogicAroundPosition(x,y,LANDING_CLEAR_RADIUS, function(x,y,result){
					if(board.isPowerUp[x][y] != PU_ID_NONE) {
						var id = board.isPowerUp[x][y];
						board.isPowerUp[x][y] = PU_ID_NONE;
						b.numPowerUpsOnBoard--;
					}
				});
			}
		},
		{
			name: 'Bulldozer blade', // TODO: add a fun visual
			description: 'After teleporting, you also clear blocks in a small radius for a short duration.',
			recipe: [2,0,2,0,0,0], // purple, yellow, blue, green, red, orange
			onChangePosition: function(x,y,p) {
				const BULLDZR_CLEARING_DURATION = 0.75; // the fraction on the CD that the effect lasts
				const BULLDZR_RADIUS_CLEAR = 2;
				if(p.cooldown >= p.maxCooldown * (1-BULLDZR_CLEARING_DURATION))
					b.clearAroundPoint(x + Math.sign(p.dx)*2,y + Math.sign(p.dy)*2,BULLDZR_RADIUS_CLEAR);
			}
		},
		{
			name: 'Chameleon Device',
			description: 'After teleporting, channel a ray on a nearby player in attempt to steal their color.',
			recipe: [2,2,0,0,0,0], // purple, yellow, blue, green, red, orange
			onTeleportLanding: function(x,y,p) {
				var nearestPlayer = b.findNearestPlayer(x,y,10,p);
				if(nearestPlayer != null) // create link if possible
					objects.createLink(p, nearestPlayer, 1.00, 12, 1);
			},
			onLinkComplete: function(A,B) {
				A.hue = B.hue;
				board.colorsLUT[A.blocId] = A.hue;
				sockets[A.id].emit('newHue', A.hue);
			}
		},
		{
			name: 'C-4',
			description: 'When your teleport is ready, the next wall you hit will cause a large clearing effect and trigger a short cooldown.',
			recipe: [0,0,2,0,2,0], // purple, yellow, blue, green, red, orange
			onPlayerWallHit: function(x,y,p) {
				const C4_CD = 2; // the cooldown triggered
				if(p.cooldown > 0)
					return false; // kill player
					
				b.triggerCooldown(p,C4_CD);
				b.clearAroundPoint(x,y,6);
				sockets[p.id].emit('trCd', C4_CD);
	
				return true;
			}
		},
		{
			name: 'Death Ray',
			description: 'After teleporting, channel a Death Ray in attempt to eliminate a nearby player.',
			recipe: [2,0,0,0,0,2], // purple, yellow, blue, green, red, orange
			onTeleportLanding: function(x,y,p) {
				var nearestPlayer = b.findNearestPlayer(x,y,8,p);
				
				if(nearestPlayer != null)  // create link if possible
					objects.createLink(p, nearestPlayer, 2.5, 9, 3);
			},
			onLinkComplete: function(A,B) {
				b.hasCrashedInto(A, B, 'You were eliminated by ' + A.name + '\'s power up ability.');
			}
		},
		{
			name: 'Air Bags',
			description: 'Crashing into a wall will cause you to lose some points instead of killing you.',
			recipe: [0,0,0,4,0,0], // purple, yellow, blue, green, red, orange
			onPlayerWallHit: function(x,y,p) {
				b.clearAroundPoint(x,y,1);
				p.pts -= Math.Max(250,p.pts*.15);
	
				return true;
			}
		},
		{
			name: 'Switch-A-Roo',
			description: 'After teleporting, channel a ray to switch position and color with another player.',
			recipe: [0,0,0,0,0,4], // purple, yellow, blue, green, red, orange
			onTeleportLanding: function(x,y,p) {
				var nearestPlayer = b.findNearestPlayer(x,y,10,p);
				if(nearestPlayer != null) // create link if possible
					objects.createLink(p, nearestPlayer, 1.50, 12, 1); // TODO: add unique effect
			},
			onLinkComplete: function(A,B) {
				var tmp = {
					x:A.x,
					y:A.y,
					dx:A.dx,
					dy:A.dy,
					hue:A.hue
				};
				b.newState(A,B.x,B.y,B.dx,B.dy,B.hue);
				b.newState(B,tmp.x,tmp.y,tmp.dx,tmp.dy,tmp.hue);
				board.colorsLUT[A.blocId] = A.hue;
				board.colorsLUT[B.blocId] = B.hue;
			}
		},
		{
			name: 'Rapid recovery',
			description: 'After teleporting, channel a ray on a nearby player in attempt to trigger their cooldown, and reset yours.',
			recipe: [2,0,0,0,2,0], // purple, yellow, blue, green, red, orange
			onTeleportLanding: function(x,y,p) {
				var nearestPlayer = b.findNearestPlayer(x,y,8,p);
				
				if(nearestPlayer != null)  // create link if possible
					objects.createLink(p, nearestPlayer, 0.75, 9, 2);
			},
			onLinkComplete: function(A,B) {
				b.triggerCooldown(A,0.15);
				sockets[A.id].emit('trCd', 0.15);
				b.triggerCooldown(B);
				sockets[B.id].emit('trCd', B.maxCooldown);
			}
		},
		{
			name: 'Improved Teleport',
			description: 'Greatly reduces the cooldown on your teleport at the cost of points.',
			recipe: [2,0,0,2,0,0], // purple, yellow, blue, green, red, orange
			afterCacheStatsLogic: function(p) {
				p.maxCooldown = 0.15;
			},
			onTeleportLanding: function(x,y,p) {
				p.pts -= 100;
			}
		},
		{
			name: 'E.M.P.',
			description: 'Clears the entire map (20 second cooldown). Replaces teleport.',
			recipe: [0,0,4,0,0,0], // purple, yellow, blue, green, red, orange
			teleportOverride: function(p) {
				b.clearEntireBoard(); // TODO: add a fun visual effect
				b.triggerCooldown(p, 20);
				sockets[p.id].emit('trCd', 20);
			}
		},
		{
			name: 'Quick Escape',
			description: 'Your teleport triggers automatically when you hit a wall. Greatly lowers the cooldown.',
			recipe: [0,0,0,0,2,2], // purple, yellow, blue, green, red, orange
			onPlayerWallHit: function(x,y,p) {
				var tx = Math.round(p.x + p.dx * p.teleportDist);
				var ty = Math.round(p.y + p.dy * p.teleportDist);				
				b.teleportPlayer(p,tx,ty);
				const SHORT_CD_QUICK_ESCAPE = 2;
				b.triggerCooldown(p,SHORT_CD_QUICK_ESCAPE);
				sockets[p.id].emit('trCd', SHORT_CD_QUICK_ESCAPE);
				b.newState(p,tx,ty,p.dx,p.dy,p.hue);
				return true;
			}
		},
		{
			name: 'Entrenchment',
			description: 'Clear everything in a large area around you, surrounding you with a thin wall (12 sec cd). Replaces teleport.',
			recipe: [0,0,2,0,0,2], // purple, yellow, blue, green, red, orange
			teleportOverride: function(p) {
				const ENTRCH_CD = 12;
				const ENTRCH_RADIUS = 12;
				var ENTRCH_RADIUS2 = ENTRCH_RADIUS*ENTRCH_RADIUS;
				var now = Date.now();
				b.applyLogicAroundPosition(p.x,p.y,ENTRCH_RADIUS, function(i,j,result,dist2) {
					if(board.blockId[i][j] != B_BORDERS) {
						if(ENTRCH_RADIUS - Math.sqrt(dist2) <= 1.35) {
							board.blockId[i][j] = p.blocId;
							board.blockTs[i][j] = now;
						} else {
							board.blockId[i][j] = B_EMPTY;
						}
					}
					return result;
				});
	
				b.triggerCooldown(p, ENTRCH_CD);
				sockets[p.id].emit('trCd', ENTRCH_CD);
			}
		},
	]
};