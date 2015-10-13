'use strict';

var assert = require('assert');
var pipeline = require('json-pipeline');

var wasmCFG = require('../wasm-cfg');
var LoopInfo = wasmCFG.LoopInfo;
var Signature = wasmCFG.Signature;
var effects = wasmCFG.effects;

function CFGBuilder(ast, table) {
  this.ast = ast;
  this.out = [];

  this.builtins = wasmCFG.builtins;
  this.functions = [];
  this.table = table;
  this.scope = [];

  this.effects = null;

  // Exit blocks to be linked to the common EXIT
  this.exits = null;

  this.cfg = null;
  this.fn = null;
  this.params = null;
  this.lastType = null;

  this.loop = null;
}
module.exports = CFGBuilder;

CFGBuilder.build = function build(ast, table) {
  return new CFGBuilder(ast, table).build();
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
  this.exits = [];
  this.effects = 0;

  var start = cfg.block('start');

  this.updateState(start, effects.EFFECT_NONE);

  this.buildParamSlots(node);
  this.buildBlock(node);
  if (cfg.currentBlock.getLastControl() === cfg.currentBlock)
    this.exits.push(cfg.currentBlock);

  cfg.setCurrentBlock(this.exits[0]);
  for (var i = 1; i < this.exits.length; i++) {
    var exit = this.exits[i];
    // Skip dangling nodes
    if (exit.nodes.length === 0 && exit.predecessors.length === 0)
      continue;
    this.merge(cfg.currentBlock, exit);
  }

  // No effects - remove state and ssa:store
  if (!this.effects) {
    var root = cfg.blocks[0];
    for (var i = 0; i < 2; i++) {
      var node = root.nodes[0];
      root.remove(0);
      cfg.remove(node);
    }
  }
  cfg.addControl('exit');

  this.effects = null;
  this.fn = null;
  this.cfg = null;
  this.params = null;
  this.exits = null;

  cfg.link();

  return cfg;
};

CFGBuilder.prototype.getState = function getState(effect) {
  this.effects |= effect;
  return this.cfg.add('ssa:load').addLiteral(this.fn.localCount);
};

CFGBuilder.prototype.updateState = function updateState(state, control,
                                                        effect) {
  this.effects |= effect;

  // Effect does not update state
  if ((effect & effects.EFFECT_NO_UPDATE_MASK) === effect)
    return;

  var value;
  if (effect) {
    // Updated state
    value = this.cfg.add('updateState', state).addLiteral(effect);
    value.setControl(control);
  } else {
    // Initial state
    value = this.cfg.add('state');
  }
  this.cfg.add('ssa:store').addLiteral(this.fn.localCount).addInput(value);
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
  var cfg = this.cfg;

  if (stmt.argument === null) {
    assert.equal(this.fn.result.name, 'void',
                 'Empty return from non-`void` fn');
    var res = cfg.addControl('exit');
    cfg.block();
    return res;
  }

  assert.notEqual(this.fn.result.name, 'void', 'Return from `void` fn');

  var val = this.buildExpression(stmt.argument, this.fn.result.name);

  // TODO(indutny): scheduler may put some junk between `type.ret` and `exit`,
  // tie them together somehow
  var res = cfg.addControl(this.fn.result.name + '.ret', val);
  this.exits.push(cfg.currentBlock);

  cfg.block();
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
  else if (actual === 'bool')
    assert.equal(expected, 'i32', msg);
  else if (expected !== 'void')
    assert.equal(actual, expected, msg);

  this.lastType = actual;
  return out;
};

CFGBuilder.prototype.buildBuiltin = function buildBuiltin(expr, type) {
  var key = expr.result.name + '.' + expr.method;
  var signature = this.builtins[key];
  var cfg = this.cfg;

  assert(signature, 'Unknown builtin: ' + key);

  if (expr.method === 'const')
    return this.buildConst(expr, key, signature, type);

  assert.equal(expr.arguments.length, signature.params.length,
               'Wrong argument count for: ' + key);

  var args = expr.arguments.map(function(arg, i) {
    return this.buildExpression(arg, signature.params[i]);
  }, this);

  var resultType = signature.result;

  var state;
  if (signature.effect) {
    state = this.getState(signature.effect);
    args.unshift(state);
  }

  var out = cfg.add(key, args);

  if (signature.effect) {
    this.updateState(state, out, signature.effect);

    // Effect node is free to move within blocks that dominate its uses
    out.setControl(cfg.currentBlock.getLastControl());
  }

  return this.typeCheck(out, resultType, type,
                        'Builtin: ' + key + ' return type mismatch');
};

CFGBuilder.prototype.buildConst = function buildConst(expr, key, signature,
                                                      type) {
  assert.equal(expr.arguments.length, 1, 'Too much arguments for .const');
  assert.equal(expr.arguments[0].type, 'Literal', '.const expects literal');

  var value = expr.arguments[0].value;

  // Floating point values should always be JS numbers
  if (type === 'f32' || type === 'f64')
    value = parseFloat(value.toString(10));

  var out = this.cfg.add(key).addLiteral(expr.arguments[0].value);
  return this.typeCheck(out, signature.result, signature.result, '');
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

  var input = this.buildExpression(expr.init, expr.result.name);
  this.cfg.add('ssa:store').addLiteral(expr.id.index).addInput(input);
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
  if (this.lastType !== 'bool')
    test = this.cfg.add(this.lastType + '.bool', test);
  this.cfg.addControl('if', test);

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
  assert(expr.fn.type === 'FunctionRef' || expr.fn.type === 'External',
         'Call of non-function variable');

  // Fetch local or external function
  var sig;
  var module = expr.fn.type === 'External' ? expr.fn.module : null;
  var index;
  if (module === null) {
    index = expr.fn.index;
    sig = this.functions[index];
    assert(sig, 'Unknown function index: ' + expr.fn.index);
  } else {
    var entry = this.table.get(expr.fn.module, expr.fn.name);
    index = entry.index;
    sig = entry.signature;
    assert(sig,
           'Unknown function name: ' + expr.fn.module + '::' + expr.fn.name);
  }

  assert.equal(expr.arguments.length, sig.params.length,
               'Not enough params for the call');

  var state = this.getState(effects.EFFECT_CALL);

  var args = [];
  for (var i = 0; i < expr.arguments.length; i++) {
    var arg = this.buildExpression(expr.arguments[i], sig.params[i]);
    args.push(arg);
  }

  var res = this.cfg.add(sig.result + '.call')
      .addInput(state)
      .setControl(this.cfg.currentBlock.getLastControl())
      .addLiteral({ module: module, index: index });

  for (var i = 0; i < expr.arguments.length; i++) {
    res.addLiteral(sig.params[i]);
    res.addInput(args[i]);
  }

  this.updateState(state, res, effects.EFFECT_CALL);

  return this.typeCheck(res, sig.result, type, '');
};
