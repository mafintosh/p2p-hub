var sockets = require('message-sockets');
var common = require('common');

var noop = function() {};

var PORT = 10547;

var networkAddress = function() {
	var ip = require('os').getNetworkInterfaces();

	for (var i in ip) {
		var cand = ip[i].filter(function(item) {
			return item.family === 'IPv4' && !item.internal;
		});

		if (cand[0]) {
			return cand[0].address;
		}
	}
	return '127.0.0.1';
};
var normalizeAddress = function(address) {
	address = address || networkAddress();

	if (!(/\w+:\/\//.test(address))) {
		address = 'json://'+address;
	}
	if (!(/:\d+$/.test(address))) {
		address += ':'+PORT;
	}
	return address;
};
var listen = function(onsocket, callback) {
	var onport = function(port) {
		sockets.listen(port, onsocket, function(err) {
			if (err) {
				onport(port+1);
				return;
			}
			callback(null, port);
		});
	};
	onport(PORT);
};

exports.connect = function(announce) {
	var that = common.createEmitter();	
	var pings = {};
	var callbacks = {};
	var members = {};
	var address;

	announce = normalizeAddress(announce);

	var onconnect = function(from, socket) {
		members[from] = socket;

		socket.on('close', function() {
			delete members[from];
			that.emit('disconnect', from);
		});

		that.emit('connect', from);		

		return socket;
	};
	var onsocket = function(socket) {
		socket.on('message', function(message) {
			var id = message.id; // used alot

			if (message.method === 'connect') {
				onconnect(message.from, socket);

				socket.send({method:'members', members:list()});
				return;
			}
			if (message.method === 'members') {
				message.members.forEach(connect);
				return;
			}
			if (message.method === 'reply') {
				var id = message.id;

				if (callbacks[id]) {
					callbacks[id](message.error && new Error(message.error), message.data);
				}
				return;
			}
			that.emit('message', message.from, message.data, !id ? noop : function(err, value) {
				// TODO: add writable checks
				socket.send({method:'reply', id:id, error:(err && err.toString()), data:value});
			});
		});	
	};

	var connect = function(destination, pathname) {
		if (members[destination] || destination === address) {
			return;
		}

		var socket = sockets.connect(destination);

		socket.send({method:'connect', from:address});

		onconnect(destination, socket);
		onsocket(socket);
	};
	var list = function() {
		return Object.keys(members);
	};
	var send = function(destination, message, callback) {
		if (callback) {
			var id = message.id = common.gensym();

			callbacks[id] = function(err, message) {
				delete callbacks[id];
				callback(err, message);
			};
		}

		members[destination].send(message);
	};
	
	that.nodes = list;
	that.send = function(destination, message, callback) {		
		if (!message) {
			message = {from:address, data:destination};

			list().forEach(function(node) {
				send(node, message);
			});
			return;
		}
		send(destination, {from:address, data:message}, callback);
	};

	common.step([
		function(next) {
			listen(onsocket, next);
		},
		function(port) {
			address = 'json://'+networkAddress()+':'+port;

			that.address = address;
			that.emit('ready', address);

			if (announce === address) {
				return;
			}
			connect(announce);
		}
	], function(err) {
		that.emit('error', err);
	});

	return that;
};