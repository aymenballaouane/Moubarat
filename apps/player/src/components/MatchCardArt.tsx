import { useId } from 'react';
import type { CardArtKind } from '../lib/matchCardView.js';

/* Illustrations de la carte de match (lot « Match libre », phase 2) — reprises TELLES QUELLES des planches Acc5 / Acc6 / Jo1 du canvas
   (dossier §6, tableau « Les images ») : stade de foot vert avec projecteurs ; court de padel avec filet, bleu (Padel · Simple) ou vert
   (Padel · Double), comme sur les maquettes ; fond rouge sombre et logo Moubarat pour un match sans centre (match libre, phase 5) ou
   un sport sans illustration. Seule adaptation : les identifiants des dégradés sont rendus uniques par carte (useId), sinon deux cartes
   d'une même page partageraient le même dégradé. */

function useSvgId(): string {
  return useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

function FootArt() {
  const id = useSvgId();
  return (
    <svg aria-hidden="true" className="mc-art__svg" viewBox="0 0 344 120" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`fdSky${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#080D14" /><stop offset="1" stopColor="#16293B" /></linearGradient>
        <radialGradient id={`fdGlow${id}`} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset=".22" stopColor="#CFE8FF" stopOpacity=".5" /><stop offset="1" stopColor="#CFE8FF" stopOpacity="0" /></radialGradient>
        <radialGradient id={`fdSpill${id}`} cx="50%" cy="30%" r="70%"><stop offset="0" stopColor="#E8FFE8" stopOpacity=".30" /><stop offset="1" stopColor="#E8FFE8" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="344" height="120" fill={`url(#fdSky${id})`} />
      <circle cx="40" cy="8" r="46" fill={`url(#fdGlow${id})`} />
      <circle cx="304" cy="8" r="46" fill={`url(#fdGlow${id})`} />
      <polygon points="0,32 344,32 344,44 0,44" fill="#070B11" />
      <g fill="#F3F7FF" opacity=".5">
        <circle cx="14" cy="36" r="1.1" /><circle cx="34" cy="39" r="1.1" /><circle cx="52" cy="35" r="1.1" /><circle cx="76" cy="38" r="1.1" />
        <circle cx="104" cy="36" r="1.1" /><circle cx="150" cy="37" r="1.1" /><circle cx="196" cy="36" r="1.1" /><circle cx="240" cy="38" r="1.1" />
        <circle cx="270" cy="35" r="1.1" /><circle cx="296" cy="38" r="1.1" /><circle cx="318" cy="36" r="1.1" /><circle cx="334" cy="39" r="1.1" />
      </g>
      <rect x="0" y="42" width="344" height="3" fill="#0A0F16" />
      <polygon points="-40.0,124.0 384.0,124.0 356.8,105.6 -12.8,105.6" fill="#25804B" />
      <polygon points="-12.8,105.6 356.8,105.6 332.6,89.2 11.4,89.2" fill="#1A6A3E" />
      <polygon points="11.4,89.2 332.6,89.2 311.6,74.9 32.4,74.9" fill="#25804B" />
      <polygon points="32.4,74.9 311.6,74.9 293.9,62.9 50.1,62.9" fill="#1A6A3E" />
      <polygon points="50.1,62.9 293.9,62.9 280.0,53.5 64.0,53.5" fill="#25804B" />
      <polygon points="64.0,53.5 280.0,53.5 270.3,46.9 73.7,46.9" fill="#1A6A3E" />
      <polygon points="73.7,46.9 270.3,46.9 266.0,44.0 78.0,44.0" fill="#25804B" />
      <polygon points="-40,124 384,124 266,44 78,44" fill={`url(#fdSpill${id})`} />
      <g fill="none" stroke="#F5F7FA" strokeOpacity=".78" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M-40 124L78 44" /><path d="M384 124L266 44" /><path d="M78 44H266" /><path d="M122 44L108 62H236L222 44" />
        <path d="M146 44L140 54H204L198 44" /><path d="M-6 100H350" /><ellipse cx="172" cy="100" rx="40" ry="10" />
      </g>
      <g fill="none" stroke="#fff" strokeOpacity=".9" strokeWidth="1.6"><path d="M158 44V40H186V44" /></g>
      <path d="M158 40H186L182 43H162Z" fill="#fff" fillOpacity=".10" />
    </svg>
  );
}

const PADEL_TINTS = {
  'padel-bleu': {
    sky: ['#060B13', '#10243A'], floor: ['#1650A0', '#3A86D8'], glow: '#CFE8FF', spill: '#9CCBFF', glass: '#BFE3FF',
    frame: '#0A1520', ground: '#07121C', lines: '#F5F8FF',
  },
  'padel-vert': {
    sky: ['#0B0910', '#2A1A12'], floor: ['#127A5E', '#2DB58F'], glow: '#FFE1B0', spill: '#FFD9A0', glass: '#E4F3E6',
    frame: '#14100E', ground: '#0E0C10', lines: '#FFFDF2',
  },
} as const;

const NET_STRANDS = [120.9, 126.0, 131.1, 136.2, 141.3, 146.4, 151.5, 156.7, 161.8, 166.9, 172.0, 177.1, 182.2, 187.3, 192.5, 197.6, 202.7, 207.8, 212.9, 218.0, 223.1];
const POSTS: [number, number][] = [[22.0, 124.0], [66.1, 97.5], [90.2, 83.1], [105.3, 74.0], [115.8, 67.8], [123.4, 63.2], [129.1, 59.7], [133.7, 57.0], [137.4, 54.8]];

function PadelArt({ tint }: { tint: 'padel-bleu' | 'padel-vert' }) {
  const id = useSvgId();
  const c = PADEL_TINTS[tint];
  return (
    <svg aria-hidden="true" className="mc-art__svg" viewBox="0 0 344 120" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`pdSky${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c.sky[0]} /><stop offset="1" stopColor={c.sky[1]} /></linearGradient>
        <linearGradient id={`pdFloor${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c.floor[0]} /><stop offset="1" stopColor={c.floor[1]} /></linearGradient>
        <radialGradient id={`pdGlow${id}`} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset=".22" stopColor={c.glow} stopOpacity=".5" /><stop offset="1" stopColor={c.glow} stopOpacity="0" /></radialGradient>
        <radialGradient id={`pdSpill${id}`} cx="50%" cy="38%" r="62%"><stop offset="0" stopColor={c.spill} stopOpacity=".42" /><stop offset="1" stopColor={c.spill} stopOpacity="0" /></radialGradient>
        <linearGradient id={`pdGlassL${id}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={c.glass} stopOpacity=".02" /><stop offset="1" stopColor={c.glass} stopOpacity=".20" /></linearGradient>
        <linearGradient id={`pdGlassR${id}`} x1="1" y1="0" x2="0" y2="0"><stop offset="0" stopColor={c.glass} stopOpacity=".02" /><stop offset="1" stopColor={c.glass} stopOpacity=".20" /></linearGradient>
        <linearGradient id={`pdNet${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset=".12" stopColor="#101820" stopOpacity=".78" /><stop offset="1" stopColor="#05090E" stopOpacity=".55" /></linearGradient>
      </defs>
      <rect width="344" height="120" fill={`url(#pdSky${id})`} />
      <rect x="0" y="44" width="344" height="120" fill={c.ground} />
      <g fill="#05080D" opacity=".7">
        <rect x="0" y="30" width="50" height="22" /><rect x="50" y="38" width="30" height="14" /><rect x="262" y="34" width="46" height="18" /><rect x="308" y="26" width="36" height="26" />
      </g>
      <circle cx="46" cy="10" r="44" fill={`url(#pdGlow${id})`} />
      <circle cx="298" cy="10" r="44" fill={`url(#pdGlow${id})`} />
      <polygon points="22.0,124.0 322.0,124.0 206.6,54.8 137.4,54.8" fill={`url(#pdFloor${id})`} />
      <polygon points="22.0,124.0 322.0,124.0 206.6,54.8 137.4,54.8" fill={`url(#pdSpill${id})`} />
      <g fill="none" stroke={c.lines} strokeOpacity=".88" strokeWidth="1.3" strokeLinecap="round">
        <path d="M72.6 93.7 H271.4" /><path d="M132.8 57.5 H211.2" /><path d="M172.0 93.7 L172.0 67.8" /><path d="M172.0 67.8 L172.0 57.5" />
        <path d="M22.0 124.0 L137.4 54.8" /><path d="M322.0 124.0 L206.6 54.8" />
      </g>
      <polygon points="137.4,34 206.6,34 206.6,54.8 137.4,54.8" fill={c.glass} fillOpacity=".13" stroke={c.frame} strokeWidth="1.4" />
      <line x1="172" y1="34" x2="172" y2="54.8" stroke={c.frame} strokeWidth="1" opacity=".8" />
      <polygon points="22.0,124.0 137.4,54.8 137.4,34 22.0,34" fill={`url(#pdGlassL${id})`} />
      <polygon points="322.0,124.0 206.6,54.8 206.6,34 322.0,34" fill={`url(#pdGlassR${id})`} />
      <g stroke={c.frame} strokeWidth="1.5" opacity=".9">
        {POSTS.map(([x, y]) => <line key={`l${x}`} x1={x} y1={y} x2={x} y2="34" />)}
        {POSTS.map(([x, y]) => <line key={`r${x}`} x1={344 - x} y1={y} x2={344 - x} y2="34" />)}
      </g>
      <g stroke={c.glass} strokeWidth=".8" opacity=".45">
        <line x1="22.0" y1="34" x2="137.4" y2="34" /><line x1="322.0" y1="34" x2="206.6" y2="34" />
      </g>
      <polygon points="115.8,57.4 228.2,57.4 228.2,67.8 115.8,67.8" fill={`url(#pdNet${id})`} />
      <g stroke="#fff" strokeOpacity=".30" strokeWidth=".5">
        {NET_STRANDS.map((x) => <line key={x} x1={x} y1="57.4" x2={x} y2="67.8" />)}
      </g>
      <line x1="114.8" y1="55.9" x2="114.8" y2="67.8" stroke="#0A1018" strokeWidth="2" />
      <line x1="229.2" y1="55.9" x2="229.2" y2="67.8" stroke="#0A1018" strokeWidth="2" />
    </svg>
  );
}

function LogoArt() {
  return (
    <span className="mc-art__logo">
      <svg aria-hidden="true" width="48" height="48" viewBox="0 0 60 60">
        <path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9" />
        <path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00" />
      </svg>
    </span>
  );
}

export function MatchCardArt({ kind }: { kind: CardArtKind }) {
  if (kind === 'foot') return <FootArt />;
  if (kind === 'padel-bleu' || kind === 'padel-vert') return <PadelArt tint={kind} />;
  return <LogoArt />;
}
