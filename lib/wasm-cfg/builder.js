'use strict';

var assert = require('assert');
var pipeline = require('json-pipeline');

var wasmCFG = require('../wasm-cfg');

function CFGBuilder(ast) {
  this.ast = ast;
  this.out = [];

  this.builtins = wasmCFG.builtins;

  this.cfg = null;
  this.fn = null;
}
module.exports = CFGBuilder;

CFGBuilder.build = function build(ast) {
  return new CFGBuilder(ast).build();
};

CFGBuilder.prototype.build = function build() {
  assert.equal(this.ast.type, 'Program');
  for (var i = 0; i < this.ast.body.length; i++) {
    var node = this.ast.body[i];
    if (node.type === 'Function')
      this.out.push(this.buildFunction(node));
  }
  return this.out;
};

CFGBuilder.prototype.buildFunction = function buildFunction(node) {
  var cfg = pipeline.create('cfg');

  this.cfg = cfg;
  this.fn = node;

  this.buildBlock(node, 'start');

  // Add implicit ret
  var lastControl = this.cfg.currentBlock.getLastControl();
  if (lastControl === null || !/\.ret$/.test(lastControl.opcode))
    this.cfg.add('ret');

  this.cfg = null;
  return cfg;
};

CFGBuilder.prototype.buildBlock = function buildBlock(node, type) {
  this.cfg.block(type);
  for (var i = 0; i < node.body.length; i++)
    this.buildStatement(node.body[i]);
};

CFGBuilder.prototype.buildStatement = function buildStatement(stmt) {
  if (stmt.type === 'ReturnStatement') {
    assert.notEqual(this.fn.result.name, 'void', 'Return from `void` fn');

    var val = this.buildExpression(stmt.argument, this.fn.result.name);
    return this.cfg.addControl(this.fn.result.name + '.ret', val);
  }

  throw new Error('Not implemented');
};

CFGBuilder.prototype.buildExpression = function buildExpression(expr, type) {
  if (expr.type === 'Builtin')
    return this.buildBuiltin(expr, type);

  if (expr.type === 'Param')
    return this.buildParam(expr, type);

  throw new Error('Not implemented');
};

CFGBuilder.prototype.buildBuiltin = function buildBuiltin(expr, type) {
  var key = expr.result.name + '.' + expr.method;
  var signature = this.builtins[key];

  assert(signature, 'Unknown builtin: ' + key);
  assert.equal(signature.result, type, 'Builtin return type mismatch');

  if (expr.method === 'const') {
    assert.equal(expr.arguments.length, 1, 'Too much arguments for .const');
    assert.equal(expr.arguments[0].type, 'Literal', '.const expects literal');
    return this.cfg.add(key).addLiteral(expr.arguments[0].value);
  }

  assert.equal(signature.params.length, expr.arguments.length,
               'Wrong argument count for: ' + key);

  var args = expr.arguments.map(function(arg, i) {
    return this.buildExpression(arg, signature.params[i]);
  }, this);
  return this.cfg.add(key, args);
};

CFGBuilder.prototype.buildParam = function buildParam(expr, type) {
  assert(expr.index < this.fn.params.length, 'Param lookup OOB');

  var signature = this.fn.params[expr.index];
  assert.equal(signature.result.name, type, 'Mismatched param type');

  return this.cfg.add(type + '.param').addLiteral(expr.index);
};
