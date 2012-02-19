var sockets = require('message-sockets');
var common = require('common');
var dns = require('dns');
var peers = require('./lib/peer');

var noop = function() {};

var PORT = 10547;

var networkAddress = function() {
	var ip = require('os').networkInterfaces();

	for (var i in ip) {
		var cand = ip[i].filter(function(item) {
			return item.family === 'IPv4' && !item.internal;
		});

		if (cand[0]) {
			return cand[0].address;
		}
	}
	return '127.0.0.1';
}();
var normalize = function(address) {
	address = address || networkAddress;

	if (!(/\w+:\/\//.test(address))) {
		address = 'json://'+address;
	}
	if (!(/:\d+$/.test(address))) {
		address += ':'+PORT;
	}
	return address;
};
var listen = function(onsocket, callback) {
	var loop = function(port) {
		var server = require('http').createServer();
		var tmp = process.env;

		process.env = {}; // HACK! this way we avoid being clustered

		server.on('error', function() {
			loop(port+1);
		});
		server.listen(port, function() {
			sockets.listen(server, onsocket);
			callback(null, port);
		});

		process.env = tmp;
	};

	loop(PORT);
};
var createHub = function(peer) {
	var hub = common.createEmitter();
	var multiplex = {};
	var onready = common.future();

	var sender = function(hub) {
		var send = function(node, message, callback) {
			if (arguments.length === 1) {
				message = node;
				hub.nodes().forEach(function(node) {
					send(node, message);
				});
				return;
			}
			if (!hub.all[node]) {
				(callback || noop)(new Error('node does not exist'));
				return;
			}

			hub.all[node].send({from:hub.address, channel:hub.channel, data:message}, callback);
		};

		return send;
	};
	var multiplexer = function(name) {
		if (multiplex[name]) {
			return multiplex[name];
		}

		var that = multiplex[name] = common.createEmitter();

		that.all = {};
		that.channel = name;
		that.send = sender(that);

		that.nodes = function() {
			return Object.keys(that.all);
		};

		hub.ready(function() {
			that.address = hub.address;
			that.emit('ready');
		});

		that.ready = hub.ready;
		that.multiplex = hub.multiplex;

		var onnode = function(node) {
			var peer = hub.all[node];

			peer.multiplex(name, function(_, joined) {
				if (!joined || that.all[node]) {
					return;
				}

				that.all[node] = peer;
				that.emit('connect', node);
			});
			peer.on('multiplex', function(channel) {
				if (channel !== name || that.all[node]) {
					return;
				}

				that.all[node] = peer;
				that.emit('connect', node);
			});
			peer.on('disconnect', function() {
				if (!that.all[node]) {
					return;
				}

				delete that.all[node];
				that.emit('disconnect', node);
			});
		};

		hub.nodes().forEach(onnode);
		hub.on('connect', onnode);

		return that;
	};

	hub.all = {};
	hub.send = sender(hub);

	hub.nodes = function() {
		return Object.keys(hub.all);	
	};
	hub.multiplex = function(name) {
		return multiplexer(name);
	};
	hub.ready = function(callback) {
		onready.get(callback);
	};

	var connect = function(socket) {
		if (typeof socket === 'string' && (hub.all[socket] || socket === hub.address)) {
			return;
		}
		if (typeof socket === 'string') {
			socket = hub.all[socket] = peers.create(hub, socket);
		} else {
			socket = peers.create(hub, socket);		
		}

		socket.ready(function(from) {
			hub.all[from] = socket;
			hub.emit('connect', from);

			if (from !== peer) {
				return;
			}

			socket.on('close', function() {
				peers.whenOnline(peer, function() {
					connect(peer);
				});
			});
		});

		socket.on('message', function(message, callback) {
			var emitter = (message.channel && multiplex[message.channel]) || hub;

			emitter.emit('message', message.from, message.data, callback);
		});
		socket.on('disconnect', function(from) {
			delete hub.all[from];
			hub.emit('disconnect', from);
		});
		socket.on('nodes', function(nodes) {
			nodes.forEach(connect);
		});
	};

	common.step([
		function(next) {
			dns.lookup(peer || networkAddress, next);
		},
		function(result, next) {
			peer = normalize(result);
			listen(connect, next);
		},
		function(port) {
			hub.address = 'json://'+networkAddress+':'+port;
			connect(peer);
			onready.put(hub.address);
			hub.emit('ready');
		}
	]);

	return hub;
};
exports.connect = function(peer, options) {
	var hub;
	var notPeer = peer && typeof peer === 'object';

	if (notPeer && typeof peer.send === 'function') {
		hub = peer;
	}
	if (notPeer && typeof peer.send !== 'function') {
		options = peer;
		peer = undefined;
	}

	options = options || {};
	hub = hub || createHub(peer);

	if (options.channel) {
		return hub.multiplex(options.channel);
	}

	return hub;
};