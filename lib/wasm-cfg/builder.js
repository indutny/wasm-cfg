'use strict';

var assert = require('assert');
var pipeline = require('json-pipeline');

var wasmCFG = require('../wasm-cfg');

function CFGBuilder(ast) {
  this.ast = ast;
  this.out = [];

  this.builtins = wasmCFG.builtins;
  this.scope = [];

  this.cfg = null;
  this.fn = null;
  this.params = null;
  this.lastType = null;
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
  var cfg = pipeline.create('dominance');

  this.cfg = cfg;
  this.fn = node;

  this.cfg.block('start');

  this.buildParamSlots(node);
  this.buildBlock(node);

  // Remove dead slots
  this.cleanupParamSlots();

  this.cfg = null;
  this.params = null;

  cfg.link();

  return cfg;
};

CFGBuilder.prototype.buildParamSlots = function buildParamSlots(node) {
  this.params = new Array(node.params.length);

  if (node.params.length === 0)
    return;

  for (var i = 0; i < node.params.length; i++) {
    var param = node.params[i];

    var type = param.result.name;
    var index = param.name.index;

    this.params[index] = this.cfg.addControl(type + '.param').addLiteral(index);
  }

  this.cfg.addControl('jump');
  this.cfg.jumpFrom(this.cfg.currentBlock);
};

CFGBuilder.prototype.cleanupParamSlots = function cleanupParamSlots() {
  for (var i = 0; i < this.params.length; i++) {
    var param = this.params[i];
    if (param.uses.length === 0)
      this.cfg.remove(param);
  }
};

CFGBuilder.prototype.buildBlock = function buildBlock(node) {
  for (var i = 0; i < node.body.length; i++)
    this.buildStatement(node.body[i]);
};

CFGBuilder.prototype.buildBlockOrStmt = function buildBlockOrStmt(node) {
  if (node.type === 'BlockStatement')
    return this.buildBlock(node);

  return this.buildStatement(node);
};

CFGBuilder.prototype.buildStatement = function buildStatement(stmt) {
  if (stmt.type === 'ReturnStatement')
    return this.buildReturn(stmt);

  if (stmt.type === 'VariableDeclaration')
    return this.buildLocalVarStmt(stmt);

  if (stmt.type === 'IfStatement')
    return this.buildIf(stmt);

  assert.equal(stmt.type, 'ExpressionStatement');
  return this.buildExpression(stmt.expression, 'void');
};

CFGBuilder.prototype.isCurrentEnded = function isCurrentEnded() {
  var last = this.cfg.currentBlock.getLastControl();
  return last !== this.cfg.currentBlock;
};

CFGBuilder.prototype.buildReturn = function buildReturn(stmt) {
  if (this.isCurrentEnded())
    return;

  if (stmt.argument === null) {
    assert.equal(this.fn.result.name, 'void',
                 'Empty return from non-`void` fn');
    return this.cfg.addControl('ret');
  }

  assert.notEqual(this.fn.result.name, 'void', 'Return from `void` fn');

  var val = this.buildExpression(stmt.argument, this.fn.result.name);
  return this.cfg.addControl(this.fn.result.name + '.ret', val);
};

CFGBuilder.prototype.buildExpression = function buildExpression(expr, type) {
  if (expr.type === 'Builtin')
    return this.buildBuiltin(expr, type);

  if (expr.type === 'Param')
    return this.buildParam(expr, type);

  if (expr.type === 'SequenceExpression')
    return this.buildSeq(expr, type);

  if (expr.type === 'Local')
    return this.buildLocalLookup(expr, type);

  if (expr.type === 'AssignmentExpression')
    return this.buildAssignment(expr, type);

  throw new Error('Not implemented: ' + expr.type);
};

CFGBuilder.prototype.typeCheck = function typeCheck(out, actual, expected,
                                                    msg) {
  if (expected === 'non-void')
    assert.notEqual(actual, 'void', msg);
  else if (expected !== 'void')
    assert.equal(actual, expected, msg);

  this.lastType = actual;
  return out;
};

CFGBuilder.prototype.buildBuiltin = function buildBuiltin(expr, type) {
  var key = expr.result.name + '.' + expr.method;
  var signature = this.builtins[key];

  assert(signature, 'Unknown builtin: ' + key);

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

  var out = this.cfg.add(key, args);
  return this.typeCheck(out, signature.result, type,
                        'Builtin return type mismatch');
};

CFGBuilder.prototype.buildParam = function buildParam(expr, type) {
  assert(expr.index < this.fn.params.length, 'Param lookup OOB');

  var signature = this.fn.params[expr.index];
  var out = this.params[expr.index];
  return this.typeCheck(out, signature.result.name, type,
                        'Mismatched param type');
};

CFGBuilder.prototype.buildSeq = function buildSeq(expr, type) {
  var last;
  assert(expr.expressions.length > 0, 'Empty sequence expression');
  for (var i = 0; i < expr.expressions.length; i++)
    last = this.buildExpression(expr.expressions[i], type);
  return last;
};

CFGBuilder.prototype.buildLocalLookup = function buildLocalLookup(expr, type) {
  var storedType = this.scope[expr.index];
  var out = this.cfg.add('ssa:load').addLiteral(expr.index);
  return this.typeCheck(out, storedType, type,
                        'Variable type does not match its use');
};

CFGBuilder.prototype.buildLocalVarStmt = function buildLocalVarStmt(expr) {
  // Store type
  this.scope[expr.id.index] = expr.result.name;

  if (expr.init === null)
    return;

  this.cfg.add('ssa:store').addLiteral(expr.id.index).addInput(
      this.buildExpression(expr.init, expr.result.name));
};

CFGBuilder.prototype.buildAssignment = function buildAssignment(expr, type) {
  assert.equal(expr.left.type, 'Local', 'Assignment to non-local variable');

  var storedType = this.scope[expr.left.index];

  var res = this.buildExpression(expr.right, type);
  this.cfg.add('ssa:store').addLiteral(expr.left.index).addInput(res);
  return this.typeCheck(res, storedType, type,
                        'Variable type does not match its use');
};

CFGBuilder.prototype.buildIf = function buildIf(stmt) {
  var test = this.buildExpression(stmt.test, 'non-void');
  this.cfg.addControl('if', this.cfg.add(this.lastType + '.bool', test));

  var ifBlock = this.cfg.currentBlock;

  // Ensure no X intersections in graph
  if (ifBlock.successors.length === 2)
    ifBlock = this.cfg.block();

  this.cfg.jumpFrom(ifBlock);

  this.buildBlockOrStmt(stmt.consequent);
  if (!this.isCurrentEnded())
    this.cfg.addControl('jump');
  var lateLeft = this.cfg.currentBlock;

  this.cfg.jumpFrom(ifBlock);

  if (stmt.alternate !== null)
    this.buildBlockOrStmt(stmt.alternate);
  if (!this.isCurrentEnded())
    this.cfg.addControl('jump');
  var lateRight = this.cfg.currentBlock;

  this.cfg.merge(lateLeft, lateRight);
};
