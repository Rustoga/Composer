(function(){
  'use strict';
  var canvas = document.getElementById('spectrum');
  if(!canvas || !canvas.getContext){ return; }
  var ctx = canvas.getContext('2d');
  if(!ctx){ return; }
  ctx.fillStyle = '#0b7f5c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = '24px sans-serif';
  ctx.fillText('JS works!', 50, 50);
})();
