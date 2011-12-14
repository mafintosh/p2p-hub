var sockets = require('message-sockets');
var common = require('common');

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
var listen = function(onsocket, callback) {
	var onport = function(port) {
		sockets.listen({port:port}, onsocket, function(err) {
			if (err) {
				onport(port+1);
				return;
			}
			callback(null, port);
		});
	};
	onport(PORT);
};
var normalizeAddress = function(address) {
	address = address || networkAddress;

	if (!(/\w+:\/\//.test(address))) {
		address = 'json://'+address;
	}
	if (!(/:\d+$/.test(address))) {
		address += ':'+PORT;
	}
	return address;
};
var addSocket = function(emitter, map, from, socket) {
	if (map[from]) {
		return;
	}
	map[from] = socket;

	socket.on('close', function() {
		delete map[from];
		emitter.emit('disconnect', from);
	});

	emitter.emit('connect', from);
};

var createMultiplex = function(channel) {
	var that = common.createEmitter();
	var members = {};

	that.joined = false;
	that.channel = channel;

	that.add = function(from, socket) {
		addSocket(that, members, from, socket);
	};
	that.nodes = function() {
		return Object.keys(members);	
	};

	return that;	
};

exports.connect = function(announce) {
	var that = common.createEmitter('that');
	var members = {};
	var channels = {};
	var callbacks = {};
	var address;

	announce = normalizeAddress(announce);

	var onaddress = common.future();

	var syncMultiplex = function(socket) {
		socket.send({type:'multiplex', from:address, channels:Object.keys(channels)});	
	};

	var onmultiplex = function(channel) {
		return channels[channel] = channels[channel] || createMultiplex(channel);		
	};
	var onconnect = function(from, socket) {
		addSocket(that, members, from, socket);

		socket.send({type:'list', members:that.nodes()});
		syncMultiplex(socket);

		return socket;
	};
	var onsocket = function(socket) {
		var types = {};

		types.connect = function(message) {
			onconnect(message.from, socket);
		};
		types.multiplex = function(message) {
			message.channels.forEach(function(channel) {
				onmultiplex(channel).add(message.from, socket);							
			});
		};
		types.list = function(message) {
			message.members.forEach(connect);
		};
		types.callback = function(message) {
			(callbacks[message.id] || noop)(message.error && new Error(message.error), message.data);
		};
		types.message = function(message) {
			var emitter = message.channel ? onmultiplex(message.channel) : that;

			emitter.emit('message', message.from, message.data, !message.id ? noop : function(err, value) {
				socket.send({type:'callback', id:message.id, data:value, err:(err && err.message)});
			});
		};

		socket.on('message', function(message) {
			types[message.type || 'message'](message);
		});
	};

	var broadcast = function(to, message) {
		if (!message) {
			message = to;
			to = Object.keys(members);
		}
		to.forEach(function(i) {
			members[i].send(message);
		});
	};
	var send = function(to, message, callback) {
		if (Array.isArray(to)) {
			to.forEach(function(destination) {
				send(destination, message);
			});
			return true;
		}
		if (!members[to]) {
			return false;
		}

		message.from = address;

		if (callback) {
			var id = message.id = common.gensym();
			
			callbacks[id] = function(err, value) {
				delete callbacks[id];
				callback(err, value);
			};
		}

		members[to].send(message);
		return true;
	};
	var connect = function(destination) {
		if (members[destination] || destination === address) {
			return;
		}

		var socket = sockets.connect(destination+'/'+encodeURIComponent(address));

		socket.send({type:'connect', from:address});
		syncMultiplex(socket);

		onconnect(destination, socket);
		onsocket(socket);
	};

	common.step([
		function(next) {
			listen(onsocket, next);
		},
		function(port) {
			that.address = address = 'json://'+networkAddress+':'+port;
			that.emit('ready', that.address);

			onaddress.put(); // fulfill the future

			if (announce === address) {
				return;
			}
			connect(announce);
		}
	], function(err) {
		that.emit('error', err);
	});

	that.nodes = function() {
		return Object.keys(members);
	};
	that.send = function(to, message, callback) {
		if (!message) {
			message = to;
			to = that.nodes();
		}
		return send(to, {data:message}, callback);
	};
	that.multiplex = function(channel) {
		var multiplex = onmultiplex(''+channel);

		if (multiplex.joined) {
			return multiplex;
		}

		multiplex.joined = true;

		onaddress.get(function() {
			multiplex.address = address;
			broadcast({type:'multiplex', from:address, channels:[multiplex.channel]});

			multiplex.emit('ready');
		});

		multiplex.send = function(to, message, callback) {
			if (!message) {
				message = to;
				to = multiplex.nodes();
			}
			send(to, {channel:multiplex.channel, data:message}, callback);
		};
		multiplex.multiplex = that.multiplex;

		return multiplex;
	};

	return that;
};
