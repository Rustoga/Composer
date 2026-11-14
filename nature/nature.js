(function(){
  'use strict';

  var canvas = document.getElementById('spectrum');
  if(!canvas || !canvas.getContext){ return; }
  var ctx = canvas.getContext('2d');
  if(!ctx){ return; }

  var hoverCard = document.getElementById('hoverCard');
  var hGroup = document.getElementById('hGroup');
  var hFreq = document.getElementById('hFreq');
  var hDesc = document.getElementById('hDesc');

  var GROUPS = [
    { id:'rumble', lo:0, hi:120, label:'Earth rumble', desc:'Geophony: distant thunder, micro-tremors, deep city sub-bass from traffic &amp; transit.', nature:{color:'#14532d',weight:0.55}, city:{color:'#3e2723',weight:0.35} },
    { id:'wind', lo:120, hi:400, label:'Wind', desc:'Geophony: moving air through foliage and structures; low continuous bed.', nature:{color:'#1d6f42',weight:0.6}, city:{color:'#5d4037',weight:0.3} },
    { id:'water', lo:400, hi:900, label:'Water', desc:'Geophony: rain, streams, waterfalls; urban fountains &amp; pipe hum.', nature:{color:'#1e7a46',weight:0.45}, city:{color:'#6d4c41',weight:0.25} },
    { id:'traffic', lo:90, hi:450, label:'Traffic', desc:'Anthrophony: engines, tires, transit rumble &mdash; dominant city low band.', nature:{color:'#475569',weight:0.1}, city:{color:'#4e342e',weight:0.8} },
    { id:'voices', lo:450, hi:1100, label:'Voices', desc:'Anthrophony &amp; biophony: speech, chatter; frog calls begin ~1 kHz.', nature:{color:'#5b8c5a',weight:0.25}, city:{color:'#6d4c41',weight:0.7} },
    { id:'birds', lo:1100, hi:4200, label:'Birds', desc:'Biophony: songbirds &amp; the dawn/dusk chorus; most active natural band.', nature:{color:'#2e7d32',weight:0.85}, city:{color:'#795548',weight:0.2} },
    { id:'frogs', lo:2500, hi:5200, label:'Frogs', desc:'Biophony: anurans (median ~3.75 kHz); call to mates &amp; defend territory at dusk.', nature:{color:'#388e3c',weight:0.55}, city:{color:'#8d6e63',weight:0.1} },
    { id:'insects', lo:4000, hi:9000, label:'Insects', desc:'Biophony: cicadas (day), crickets &amp; katydids (night, up to 15 kHz); high continuous texture.', nature:{color:'#43a047',weight:0.7}, city:{color:'#a1887f',weight:0.15} },
    { id:'high', lo:9000, hi:20000, label:'High air', desc:'Geophony &amp; insects: leaf rustle, bat echolocation, ultra-high stridulation; air itself.', nature:{color:'#66bb6a',weight:0.4}, city:{color:'#bcaaa4',weight:0.05} },
  ];

  var state = { env:'nature', season:'spring', style:'rx', time:0.25, playing:false, hover:{x:-1,y:-1} };

  function seasonFactor(s){
    return {
      spring:{ birds:1.0, frogs:0.9, insects:0.5, wind:0.6, water:0.8, voices:0.4, traffic:0.5, rumble:0.4, wind2:0.6, high:0.3 },
      summer:{ birds:0.8, frogs:0.6, insects:1.0, wind:0.5, water:0.4, voices:0.5, traffic:0.6, rumble:0.5, wind2:0.5, high:0.6 },
      autumn:{ birds:0.5, frogs:0.3, insects:0.6, wind:0.9, water:0.7, voices:0.5, traffic:0.7, rumble:0.6, wind2:0.9, high:0.3 },
      winter:{ birds:0.2, frogs:0.05, insects:0.1, wind:1.0, water:0.9, voices:0.4, traffic:0.7, rumble:0.7, wind2:1.0, high:0.2 },
    }[s];
  }

  function timeFactor(t){
    var phase = (t * 24 + 6) % 24;
    var dawn = Math.exp(-((phase-6.5)*(phase-6.5)) / 6);
    var dusk = Math.exp(-((phase-19.5)*(phase-19.5)) / 8);
    var day = (phase > 8 && phase < 17) ? 1 : 0;
    var night = (phase > 20 || phase < 5) ? 1 : 0;
    return { dawn:dawn, dusk:dusk, day:day, night:night, phase:phase };
  }

  var raf;
  var BAR_COUNT = 200;

  function resize(){
    try{
      var wrap = document.querySelector('.spectrum-wrap');
      var dpr = Math.max(1, window.devicePixelRatio || 1);
      var w = wrap ? wrap.clientWidth : 980;
      var h = 420;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }catch(e){}
  }
  window.addEventListener('resize', resize);
  resize();

  function freqBin(i, bins){
    return 20 * Math.pow(20000 / 20, i / (bins - 1));
  }

  function groupForFreq(f){
    for(var g = 0; g < GROUPS.length; g++){
      if(f >= GROUPS[g].lo && f < GROUPS[g].hi){ return GROUPS[g]; }
    }
    return GROUPS[GROUPS.length - 1];
  }

  function draw(){
    try{
      var dpr = Math.max(1, window.devicePixelRatio || 1);
      var W = canvas.width / dpr;
      var H = canvas.height / dpr;
      ctx.clearRect(0, 0, W, H);

      var sf = seasonFactor(state.season);
      var tf = timeFactor(state.time);
      var isNature = state.env === 'nature';

      var bins = BAR_COUNT;
      var energy = new Float32Array(bins);

      function addBand(lo, hi, val){
        var iLo = Math.floor((Math.log(lo / 20) / Math.log(20000 / 20)) * bins);
        var iHi = Math.ceil((Math.log(hi / 20) / Math.log(20000 / 20)) * bins);
        for(var i = iLo; i < iHi && i < bins; i++){
          if(val > energy[i]){ energy[i] = val; }
        }
      }

      if(isNature){
        addBand(1100, 4200, Math.max(tf.dawn, tf.dusk) * sf.birds);
        addBand(2500, 5200, Math.max(tf.dusk, tf.night ? 0.6 : 0) * sf.frogs);
        addBand(4000, 9000, ((tf.day ? 0.5 : 0) + (tf.night ? 0.55 : 0)) * sf.insects);
        addBand(150, 500, sf.wind * 0.7);
        addBand(600, 1200, sf.water * 0.6);
        addBand(8500, 16000, sf.high * 0.5);
        addBand(0, 120, 0.4);
      } else {
        addBand(90, 450, 0.9);
        addBand(450, 1100, 0.6);
        addBand(60, 140, 0.5);
        addBand(1100, 4200, sf.birds * 0.25);
        addBand(4500, 7500, sf.insects * 0.2);
        addBand(0, 120, 0.5);
      }

      if(state.style === 'rx'){ drawRX(W, H, energy, bins, isNature); }
      else if(state.style === 'bars'){ drawBars(W, H, energy, bins, isNature); }
      else{ drawRadial(W, H, energy, bins, isNature); }

      drawHover(W, H, energy, bins, isNature);
    }catch(e){
      console.log('draw frame failed', e);
    }
    raf = requestAnimationFrame(draw);
  }

  function drawRX(W, H, energy, bins, isNature){
    var grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, '#0b1410');
    grad.addColorStop(0.5, '#0f1c16');
    grad.addColorStop(1, '#0b1410');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    var binW = W / bins;
    for(var i = 0; i < bins; i++){
      var f = freqBin(i, bins);
      var g = groupForFreq(f);
      var col = isNature ? g.nature.color : g.city.color;
      var e = energy[i];
      if(e < 0.015){ continue; }
      var barH = Math.pow(e, 0.75) * (H * 0.82);
      var y = H - barH;
      ctx.globalAlpha = 0.3 + e * 0.7;
      ctx.fillStyle = col;
      ctx.fillRect(i * binW, y, Math.max(1, binW - 0.5), barH);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(46,125,50,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.5);
    ctx.lineTo(W, H * 0.5);
    ctx.stroke();

    var px = state.time * W;
    ctx.strokeStyle = '#8bc34a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();
    ctx.fillStyle = '#8bc34a';
    ctx.beginPath();
    ctx.arc(px, H * 0.5, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBars(W, H, energy, bins, isNature){
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    var binW = W / bins;
    for(var i = 0; i < bins; i++){
      var f = freqBin(i, bins);
      var g = groupForFreq(f);
      var col = isNature ? g.nature.color : g.city.color;
      var e = energy[i];
      var barH = Math.pow(e, 0.8) * (H * 0.78);
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.5 + e * 0.5;
      ctx.fillRect(i * binW, H - barH, Math.max(1, binW - 1), barH);
    }
    ctx.globalAlpha = 1;

    var px = state.time * W;
    ctx.strokeStyle = '#0b7f5c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();
  }

  function drawRadial(W, H, energy, bins, isNature){
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, H);
    var cx = W * 0.5;
    var cy = H * 0.55;
    var r = Math.min(W, H) * 0.4;
    for(var i = 0; i < bins; i++){
      var ang = (i / (bins - 1)) * Math.PI * 2;
      var f = freqBin(i, bins);
      var g = groupForFreq(f);
      var col = isNature ? g.nature.color : g.city.color;
      var e = energy[i];
      var len = Math.pow(e, 0.85) * r * 0.85;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.4 + e * 0.5;
      ctx.lineWidth = 2 + e * 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0b7f5c';
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
    var px = state.time * W;
    ctx.strokeStyle = '#0b7f5c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();
  }

  function drawHover(W, H, energy, bins, isNature){
    if(!hoverCard){ return; }
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var mx = (state.hover.x - rect.left) * dpr;
    if(mx < 0 || mx > W){ hoverCard.classList.remove('show'); return; }

    var t = mx / W;
    var f = freqBin(Math.floor(t * (bins - 1)), bins);
    var g = groupForFreq(f);
    var idx = Math.floor(t * (bins - 1));
    var e = energy[idx];
    var col = isNature ? g.nature.color : g.city.color;

    var binW = W / bins;
    var loY = H * (1 - Math.log(g.hi / 20) / Math.log(20000 / 20));
    var hiY = H * (1 - Math.log(Math.max(g.lo, 20) / 20) / Math.log(20000 / 20));
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.18 + Math.min(e, 1) * 0.25;
    ctx.fillRect(Math.max(0, mx - binW * 0.5), loY, binW, hiY - loY);
    ctx.globalAlpha = 1;

    hoverCard.classList.add('show');
    hGroup.textContent = g.label;
    hFreq.textContent = (f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : Math.round(f) + ' Hz') + ' band';
    hDesc.textContent = g.desc;
    hoverCard.style.left = (state.hover.x - rect.left) + 'px';
    hoverCard.style.top = '10px';
    hoverCard.style.transform = 'translateX(-50%)';
  }

  canvas.addEventListener('mousemove', function(e){
    state.hover = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('touchmove', function(e){
    state.hover = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: false });

  canvas.addEventListener('mouseleave', function(){
    hoverCard.classList.remove('show');
    state.hover.x = -1;
  });

  canvas.addEventListener('touchend', function(){
    hoverCard.classList.remove('show');
    state.hover.x = -1;
  });

  draw();
})();
