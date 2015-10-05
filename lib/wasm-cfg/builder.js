'use strict';

var assert = require('assert');
var pipeline = require('json-pipeline');

var wasmCFG = require('../wasm-cfg');
var LoopInfo = wasmCFG.LoopInfo;
var Signature = wasmCFG.Signature;

function CFGBuilder(ast) {
  this.ast = ast;
  this.out = [];

  this.builtins = wasmCFG.builtins;
  this.functions = [];
  this.scope = [];

  this.cfg = null;
  this.fn = null;
  this.params = null;
  this.lastType = null;

  this.loop = null;
}
module.exports = CFGBuilder;

CFGBuilder.build = function build(ast) {
  return new CFGBuilder(ast).build();
};

CFGBuilder.prototype.jumpFrom = function jumpFrom(block) {
  var cfg = this.cfg;
  block.addControl(cfg.create('jump'));
  return cfg.jumpFrom(block);
};

CFGBuilder.prototype.merge = function merge(left, right) {
  var cfg = this.cfg;

  left.addControl(cfg.create('jump'));
  right.addControl(cfg.create('jump'));
  cfg.merge(left, right);
};

CFGBuilder.prototype.build = function build() {
  assert.equal(this.ast.type, 'Program');

  // Store function signatures
  for (var i = 0; i < this.ast.body.length; i++) {
    var node = this.ast.body[i];
    if (node.type === 'Function')
      this.declareFunction(node);
  }

  for (var i = 0; i < this.ast.body.length; i++) {
    var node = this.ast.body[i];
    if (node.type === 'Function') {
      this.out.push({
        index: node.name.index,
        name: node.name.name,
        signature: this.functions[node.name.index],
        ast: node,
        cfg: this.buildFunction(node)
      });
    }
  }
  return this.out;
};

CFGBuilder.prototype.declareFunction = function declareFunction(node) {
  var params = node.params.map(function(param) {
    return param.result.name;
  });
  this.functions[node.name.index] = new Signature(node.result.name, params);
};

CFGBuilder.prototype.buildFunction = function buildFunction(node) {
  var cfg = pipeline.create('dominance');

  this.cfg = cfg;
  this.fn = node;

  this.cfg.block('start');

  this.buildParamSlots(node);
  this.buildBlock(node);
  if (this.cfg.currentBlock.getLastControl() === this.cfg.currentBlock) {
    if (this.fn.result.name === 'void')
      this.cfg.addControl('ret');
  }

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

  // Build extra block
  this.jumpFrom(this.cfg.currentBlock);
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

  if (stmt.type === 'ForeverStatement')
    return this.buildForever(stmt);

  if (stmt.type === 'DoWhileStatement')
    return this.buildDoWhile(stmt);

  if (stmt.type === 'BreakStatement')
    return this.buildBreak(stmt);

  if (stmt.type === 'ContinueStatement')
    return this.buildContinue(stmt);

  assert.equal(stmt.type, 'ExpressionStatement');
  return this.buildExpression(stmt.expression, 'void');
};

CFGBuilder.prototype.buildReturn = function buildReturn(stmt) {
  if (stmt.argument === null) {
    assert.equal(this.fn.result.name, 'void',
                 'Empty return from non-`void` fn');
    var res = this.cfg.addControl('ret');
    this.cfg.block();
    return res;
  }

  assert.notEqual(this.fn.result.name, 'void', 'Return from `void` fn');

  var val = this.buildExpression(stmt.argument, this.fn.result.name);
  var res = this.cfg.addControl(this.fn.result.name + '.ret', val);
  this.cfg.block();
  return res;
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

  if (expr.type === 'CallExpression')
    return this.buildCall(expr, type);

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

    var value = expr.arguments[0].value;

    // Floating point values should always be JS numbers
    if (type === 'f32' || type === 'f64')
      value = parseFloat(value.toString(10));

    var out = this.cfg.add(key).addLiteral(expr.arguments[0].value);
    return this.typeCheck(out, signature.result, signature.result, '');
  }

  assert.equal(signature.params.length, expr.arguments.length,
               'Wrong argument count for: ' + key);

  var args = expr.arguments.map(function(arg, i) {
    return this.buildExpression(arg, signature.params[i]);
  }, this);

  var out;
  if (signature.control)
    out = this.cfg.addControl(key, args);
  else
    out = this.cfg.add(key, args);
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
  var ifBlock = this.cfg.currentBlock;

  if (ifBlock.predecessors.length === 2)
    ifBlock = this.jumpFrom(ifBlock);

  var test = this.buildExpression(stmt.test, 'non-void');
  this.cfg.addControl('if', this.cfg.add(this.lastType + '.bool', test));

  this.cfg.jumpFrom(ifBlock);

  this.buildBlockOrStmt(stmt.consequent);
  var lateLeft = this.cfg.currentBlock;

  this.cfg.jumpFrom(ifBlock);

  if (stmt.alternate !== null)
    this.buildBlockOrStmt(stmt.alternate);
  var lateRight = this.cfg.currentBlock;

  this.merge(lateLeft, lateRight);
};

CFGBuilder.prototype.buildForever = function buildForever(stmt) {
  var cfg = this.cfg;

  // No X intersections
  if (cfg.currentBlock.predecessors.length === 2)
    this.jumpFrom(cfg.currentBlock);

  var prestartBlock = cfg.currentBlock;
  var startBlock = cfg.block();
  this.loop = new LoopInfo(this.loop);

  // Create separate body block to prevent self-looping
  this.jumpFrom(startBlock);
  this.buildBlockOrStmt(stmt.body);

  // Loop
  cfg.addControl('jump');
  cfg.currentBlock.jump(startBlock);

  this.loop.routeContinue(cfg, prestartBlock, startBlock);

  this.loop.routeBreak(cfg, null);
  this.loop = this.loop.exit();
};

CFGBuilder.prototype.buildDoWhile = function buildDoWhile(stmt) {
  var cfg = this.cfg;

  // No X intersections
  if (cfg.currentBlock.predecessors.length === 2)
    this.jumpFrom(cfg.currentBlock);

  var startBlock = this.jumpFrom(cfg.currentBlock);
  this.loop = new LoopInfo(this.loop);

  // Create separate body block to prevent self-looping
  this.jumpFrom(startBlock);
  this.buildBlockOrStmt(stmt.body);

  var endBlock = cfg.currentBlock;
  var loopBlock = cfg.createBlock();
  this.loop.routeContinue(cfg, endBlock, loopBlock);

  // Loop
  cfg.setCurrentBlock(loopBlock);

  var test = this.buildExpression(stmt.test, 'non-void');
  cfg.addControl('if', cfg.add(this.lastType + '.bool', test));

  // True branch
  cfg.jumpFrom(loopBlock);
  cfg.addControl('jump');
  cfg.currentBlock.jump(startBlock);

  // False branch
  cfg.jumpFrom(loopBlock);
  this.loop.routeBreak(cfg, cfg.currentBlock);

  this.loop = this.loop.exit();
};

CFGBuilder.prototype.buildBreak = function buildBreak() {
  this.cfg.addControl('jump');
  this.cfg.currentBlock.jump(this.loop.createBreak(this.cfg));

  this.cfg.block();
};

CFGBuilder.prototype.buildContinue = function buildContinue() {
  this.cfg.addControl('jump');
  this.cfg.currentBlock.jump(this.loop.createContinue(this.cfg));

  this.cfg.block();
};

CFGBuilder.prototype.buildCall = function buildCall(expr, type) {
  assert.equal(expr.fn.type, 'FunctionRef', 'Call of non-function variable');
  var sig = this.functions[expr.fn.index];

  assert(sig, 'Unknown function index: ' + expr.fn.index);
  assert.equal(expr.arguments.length, sig.params.length,
               'Not enough params for the call');

  var args = [];
  for (var i = 0; i < expr.arguments.length; i++) {
    var arg = this.buildExpression(expr.arguments[i], sig.params[i]);
    args.push(arg);
  }

  var res = this.cfg.addControl(sig.result + '.call')
      .addLiteral(expr.fn.index);

  for (var i = 0; i < expr.arguments.length; i++) {
    res.addLiteral(sig.params[i]);
    res.addInput(args[i]);
  }

  return this.typeCheck(res, sig.result, type, '');
};
