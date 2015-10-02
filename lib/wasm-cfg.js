'use strict';

exports.Signature = require('./wasm-cfg/signature');
exports.builtins = require('./wasm-cfg/builtins');

exports.LoopInfo = require('./wasm-cfg/loop-info');
exports.CFGBuilder = require('./wasm-cfg/builder');
exports.build = exports.CFGBuilder.build;
