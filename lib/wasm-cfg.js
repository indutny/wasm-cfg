'use strict';

exports.builtins = require('./wasm-cfg/builtins');

exports.CFGBuilder = require('./wasm-cfg/builder');
exports.build = exports.CFGBuilder.build;
