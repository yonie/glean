"use strict";
/* Shared helpers, constants and app state. Loaded first.
   Plain (non-module) script so the app runs from file:// with no build step. */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

// Curated colors for common drum/sound categories; anything else gets a stable
// hashed hue, so the app works on ANY folder structure (not one fixed library).
const palette={KICKS:"#ff5d5d",SNARES:"#ffd34e",CLAPS:"#ff9f43",HATS:"#5ad1c4",TOMS:"#c08bff",
  PERC:"#7ee081",CYMBALS:"#9ad0ff",BASS:"#ff7ac0",LEADS:"#6ea8ff",PADS:"#b6a6ff",FX:"#9aa0aa",
  LOOPS:"#e0e060",KITS:"#5ad1c4",RECORDED:"#ff9f43",INCOMING:"#8b93a4",OTHER:"#6b7280"};
const _hc={};
function colorFor(name){ if(palette[name])return palette[name]; if(_hc[name])return _hc[name];
  let h=0; for(let i=0;i<name.length;i++) h=(h*31+name.charCodeAt(i))>>>0;
  return _hc[name]=`hsl(${h%360} 62% 62%)`; }
const ORDER=["KICKS","SNARES","CLAPS","HATS","TOMS","PERC","CYMBALS","BASS","LEADS","PADS","FX","LOOPS","KITS","RECORDED","INCOMING"];

// Sound types used for dot colors / legend. Each sample's type is derived from how it
// SOUNDS (audio analysis — see classifyAudio in dsp.js), never from its filename, so an
// untitled recording like "MOOG.wav" still lands on a color by its timbre.
const TYPE_ORDER=["KICKS","SNARES","CLAPS","HATS","TOMS","PERC","CYMBALS","BASS","LEADS","PADS","FX","LOOPS","OTHER"];
const atype=new Map();                       // path -> audio-derived sound type (filled during analysis)
function audioType(it){ return atype.get(it.path)||"OTHER"; }
const typeFilter=new Set();                  // active legend filters; empty = show all types

// ---- app state ----
let items=[], cats=[], curPath=[], selected=null, view="map";
const bufCache=new Map(), feat=new Map();
let actx=null, auditionSrc=null, mapPts=[], analyzing=false;

// ---- drum machine state ----
const NT=8, NS=16;
const FXDEF=()=>({vol:0.85,pan:0,cut:18000,q:0.8,low:0,high:0,pitch:0,mute:false});
const tracks=Array.from({length:NT},()=>({item:null,buffer:null,type:null,fx:FXDEF(),nodes:null}));
const pattern=Array.from({length:NT},()=>new Array(NS).fill(false));
let activeTrack=0;

function ac(){ if(!actx) actx=new (window.AudioContext||window.webkitAudioContext)(); return actx; }
