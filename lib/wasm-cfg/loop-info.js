'use strict';

function LoopInfo(parent) {
  this.parent = parent;
  this.breakBlocks = [];
  this.continueBlocks = [];
}
module.exports = LoopInfo;

LoopInfo.prototype.routeBreak = function routeBreak(cfg, from) {
  if (this.breakBlocks.length === 0)
    return cfg.block();

  cfg.setCurrentBlock(this.breakBlocks[0]);
  for (var i = 1; i < this.breakBlocks.length; i++) {
    var next = this.breakBlocks[i];
    cfg.addControl('jump');
    cfg.currentBlock.jump(next);
    cfg.setCurrentBlock(next);
  }
};

LoopInfo.prototype.routeContinue = function routeContinue(cfg, from, to) {
  cfg.setCurrentBlock(from);
  this.continueBlocks.push(to);
  for (var i = 0; i < this.continueBlocks.length; i++) {
    var next = this.continueBlocks[i];
    cfg.addControl('jump');
    cfg.currentBlock.jump(next);
    cfg.setCurrentBlock(next);
  }
};

LoopInfo.prototype.createBreak = function createBreak(cfg) {
  var res = cfg.createBlock();
  this.breakBlocks.push(res);
  return res;
};

LoopInfo.prototype.createContinue = function createContinue(cfg) {
  var res = cfg.createBlock();
  this.continueBlocks.push(res);
  return res;
};

LoopInfo.prototype.exit = function exit() {
  return this.parent;
};
