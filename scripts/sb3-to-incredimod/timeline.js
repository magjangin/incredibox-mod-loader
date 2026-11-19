// Simulate each Sprunki character's "Loop 1" / "Loop 2" Scratch scripts (phase 1 by default)
// and sample the costume timeline into Incredibox frames.
//
// Scratch timing model: 30 fps. "wait d" resumes at the first frame boundary >= now + d.
// Non-warp repeat loops yield one frame per iteration. A loop's script is cut at loopSec.
//
// usage (module): simulate(project, { phase, loopSec, framesPerLoop, idles }) -> [{ name, A, B, warnings }]

const FPS = 30;

function makeInterpreter(target, env) {
  const B = target.blocks;
  const defs = {};
  for (const [id, b] of Object.entries(B)) {
    if (b.opcode === 'procedures_definition') {
      const proto = B[b.inputs.custom_block[1]];
      const m = proto.mutation;
      defs[m.proccode] = {
        body: b.next,
        argNames: JSON.parse(m.argumentnames || '[]'),
        argIds: JSON.parse(m.argumentids || '[]'),
        warp: m.warp === 'true' || m.warp === true,
      };
    }
  }
  const costumeNames = target.costumes.map((c) => c.name);
  const vars = {};
  for (const [, v] of Object.entries(target.variables || {})) vars[v[0]] = String(v[1]);
  const warnings = new Set();

  function inputValue(b, name, ctx) {
    const inp = b.inputs[name];
    if (!inp) return '';
    const v = inp[1];
    if (Array.isArray(v)) {
      if (v[0] === 12) return getVar(v[1]); // variable reporter
      if (v[0] === 13) return ''; // list reporter
      return String(v[1]);
    }
    if (typeof v === 'string') return evalBlock(v, ctx);
    return '';
  }

  function getVar(name) {
    if (name in env.vars) return String(env.vars[name]);
    if (name in vars) return vars[name];
    warnings.add(`unknown variable ${name}`);
    return '0';
  }

  function num(x) {
    const n = Number(x);
    return Number.isNaN(n) ? 0 : n;
  }

  function cmp(a, b) {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
    return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
  }

  function evalBlock(id, ctx) {
    const b = B[id];
    if (!b) return '';
    switch (b.opcode) {
      case 'argument_reporter_string_number':
      case 'argument_reporter_boolean':
        return ctx.args[b.fields.VALUE[0]] ?? '';
      case 'looks_costume':
        return b.fields.COSTUME[0];
      case 'operator_equals':
        return cmp(inputValue(b, 'OPERAND1', ctx), inputValue(b, 'OPERAND2', ctx)) === 0;
      case 'operator_gt':
        return cmp(inputValue(b, 'OPERAND1', ctx), inputValue(b, 'OPERAND2', ctx)) > 0;
      case 'operator_lt':
        return cmp(inputValue(b, 'OPERAND1', ctx), inputValue(b, 'OPERAND2', ctx)) < 0;
      case 'operator_and':
        return truthy(inputValue(b, 'OPERAND1', ctx)) && truthy(inputValue(b, 'OPERAND2', ctx));
      case 'operator_or':
        return truthy(inputValue(b, 'OPERAND1', ctx)) || truthy(inputValue(b, 'OPERAND2', ctx));
      case 'operator_not':
        return !truthy(inputValue(b, 'OPERAND', ctx));
      case 'operator_add':
        return String(num(inputValue(b, 'NUM1', ctx)) + num(inputValue(b, 'NUM2', ctx)));
      case 'operator_subtract':
        return String(num(inputValue(b, 'NUM1', ctx)) - num(inputValue(b, 'NUM2', ctx)));
      case 'operator_multiply':
        return String(num(inputValue(b, 'NUM1', ctx)) * num(inputValue(b, 'NUM2', ctx)));
      case 'operator_divide':
        return String(num(inputValue(b, 'NUM1', ctx)) / num(inputValue(b, 'NUM2', ctx)));
      case 'operator_join':
        return String(inputValue(b, 'STRING1', ctx)) + String(inputValue(b, 'STRING2', ctx));
      case 'data_itemoflist':
        return env.listItem(b.fields.LIST[0], inputValue(b, 'INDEX', ctx));
      default:
        warnings.add(`unsupported reporter ${b.opcode}`);
        return '';
    }
  }

  function truthy(v) {
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase();
    return !(s === '' || s === '0' || s === 'false');
  }

  // Generator: yields seconds to wait (0 = one frame yield).
  function* runStack(id, ctx) {
    while (id) {
      const b = B[id];
      if (!b) return;
      yield* runBlock(id, b, ctx);
      if (ctx.stopped) return;
      id = b.next;
    }
  }

  function* runBlock(id, b, ctx) {
    switch (b.opcode) {
      case 'looks_switchcostumeto': {
        const v = inputValue(b, 'COSTUME', ctx);
        env.setCostume(resolveCostume(v));
        return;
      }
      case 'looks_nextcostume': {
        const i = costumeNames.indexOf(env.costume);
        env.setCostume(costumeNames[(i + 1) % costumeNames.length]);
        return;
      }
      case 'control_wait': {
        yield Math.max(0, num(inputValue(b, 'DURATION', ctx)));
        return;
      }
      case 'control_repeat': {
        const times = Math.round(num(inputValue(b, 'TIMES', ctx)));
        for (let i = 0; i < times; i++) {
          if (b.inputs.SUBSTACK) yield* runStack(b.inputs.SUBSTACK[1], ctx);
          if (ctx.stopped) return;
          if (!ctx.warp) yield 0;
        }
        return;
      }
      case 'control_if': {
        if (truthy(inputValue(b, 'CONDITION', ctx)) && b.inputs.SUBSTACK) yield* runStack(b.inputs.SUBSTACK[1], ctx);
        return;
      }
      case 'control_if_else': {
        const branch = truthy(inputValue(b, 'CONDITION', ctx)) ? 'SUBSTACK' : 'SUBSTACK2';
        if (b.inputs[branch]) yield* runStack(b.inputs[branch][1], ctx);
        return;
      }
      case 'control_stop':
        ctx.stopped = true;
        return;
      case 'procedures_call': {
        const def = defs[b.mutation.proccode];
        if (!def) {
          warnings.add(`missing procedure ${b.mutation.proccode}`);
          return;
        }
        const ids = JSON.parse(b.mutation.argumentids || '[]');
        const args = {};
        def.argIds.forEach((argId, i) => {
          args[def.argNames[i]] = inputValue(b, ids[i] ?? argId, ctx);
        });
        const sub = { args, warp: ctx.warp || def.warp, stopped: false };
        yield* runStack(def.body, sub);
        return;
      }
      case 'data_setvariableto':
        vars[b.fields.VARIABLE[0]] = String(inputValue(b, 'VALUE', ctx));
        return;
      case 'data_changevariableby':
        vars[b.fields.VARIABLE[0]] = String(num(vars[b.fields.VARIABLE[0]]) + num(inputValue(b, 'VALUE', ctx)));
        return;
      case 'sound_play':
      case 'sound_playuntildone': {
        env.playSound(resolveSound(inputValue(b, 'SOUND_MENU', ctx)));
        return;
      }
      // Visual side effects that do not change the costume timeline.
      case 'sound_setvolumeto':
      case 'looks_seteffectto':
      case 'looks_changeeffectby':
      case 'looks_cleargraphiceffects':
      case 'motion_changeyby':
      case 'motion_changexby':
      case 'motion_sety':
      case 'motion_setx':
      case 'event_broadcast':
        return;
      default:
        warnings.add(`unsupported block ${b.opcode}`);
    }
  }

  function resolveCostume(v) {
    const s = String(v);
    if (costumeNames.includes(s)) return s;
    const n = Number(s);
    if (s.trim() !== '' && !Number.isNaN(n)) {
      const len = costumeNames.length;
      const idx = ((((Math.round(n) - 1) % len) + len) % len);
      return costumeNames[idx];
    }
    warnings.add(`unknown costume "${s}"`);
    return env.costume;
  }

  function resolveSound(v) {
    const names = target.sounds.map((s) => s.name);
    const s = String(v);
    if (names.includes(s)) return s;
    const n = Number(s);
    if (s.trim() !== '' && !Number.isNaN(n) && names.length) {
      const idx = ((((Math.round(n) - 1) % names.length) + names.length) % names.length);
      return names[idx];
    }
    warnings.add(`unknown sound "${s}"`);
    return null;
  }

  function hatsFor(message) {
    return Object.values(B).filter(
      (b) => b.opcode === 'event_whenbroadcastreceived' && b.fields.BROADCAST_OPTION[0] === message
    );
  }

  return { runStack, hatsFor, warnings, costumeNames };
}

// Run every "Loop N" hat of the target for loopSec seconds; return [{t, costume}] change events.
function runLoop(target, message, opts, startCostume) {
  const events = [];
  const sounds = [];
  const env = {
    vars: opts.vars,
    costume: startCostume,
    listItem: () => '1', // every character placed, every polo enabled
    setCostume(name) {
      this.costume = name;
      events.push({ t: currentTime, costume: name });
    },
    playSound(name) {
      if (name) sounds.push({ t: currentTime, sound: name });
    },
  };
  let currentTime = 0;
  const interp = makeInterpreter(target, env);
  const threads = interp.hatsFor(message).map((hat) => ({
    gen: interp.runStack(hat.next, { args: {}, warp: false, stopped: false }),
    wakeAt: 0,
    done: false,
  }));
  const frame = 1 / FPS;
  for (let f = 0; f * frame < opts.loopSec; f++) {
    currentTime = f * frame;
    for (const th of threads) {
      if (th.done || th.wakeAt > currentTime + 1e-9) continue;
      // run until the thread yields
      const r = th.gen.next();
      if (r.done) {
        th.done = true;
        continue;
      }
      const wait = r.value;
      th.wakeAt = wait <= 0 ? currentTime + frame : currentTime + wait;
    }
  }
  return { events, sounds, endCostume: env.costume, warnings: interp.warnings, costumeNames: interp.costumeNames };
}

function sample(events, startCostume, loopSec, framesPerLoop) {
  const out = [];
  let i = 0;
  let cur = startCostume;
  for (let k = 0; k < framesPerLoop; k++) {
    const t = (k * loopSec) / framesPerLoop;
    while (i < events.length && events[i].t <= t + 1e-9) cur = events[i++].costume;
    out.push(cur);
  }
  return out;
}

// Idle (placed, not yet looping) costume: per-character override, then 'idle2' (phase 2) / 'idle',
// then '0' (Interbox-style projects switch to "0" on "Start Polo"), then the first costume.
function idleCostume(t, phase, override) {
  const has = (n) => t.costumes.some((c) => c.name === n);
  if (override) {
    if (!has(override)) throw new Error(`${t.name}: idle costume ${override} missing`);
    return override;
  }
  if (phase === '2' && has('idle2')) return 'idle2';
  if (has('idle')) return 'idle';
  if (has('0')) return '0';
  return t.costumes[0].name;
}

function simulate(project, { phase = '1', loopSec = 4.8, framesPerLoop = 116, idles = [] } = {}) {
  const chars = project.targets.slice(1, 21);
  const stageVars = {};
  for (const v of Object.values(project.targets[0].variables || {})) stageVars[v[0]] = String(v[1]);
  const vars = {
    ...stageVars,
    phase,
    'Polo Im On RN': '1',
    'Freeze Muted Polos?': '1',
    MuteEnable: '1',
    Character: '1',
  };
  return chars.map((t, i) => {
    const idle = idleCostume(t, phase, idles[i]);
    const a = runLoop(t, 'Loop 1', { vars, loopSec }, idle);
    const b = runLoop(t, 'Loop 2', { vars, loopSec }, a.endCostume);
    return {
      name: t.name,
      idle,
      A: sample(a.events, idle, loopSec, framesPerLoop),
      B: sample(b.events, a.endCostume, loopSec, framesPerLoop),
      soundsA: a.sounds,
      soundsB: b.sounds,
      warnings: [...new Set([...a.warnings, ...b.warnings])],
    };
  });
}

module.exports = { simulate };

if (require.main === module) {
  const project = require(require('path').resolve(process.argv[2]));
  const res = simulate(project, { phase: process.argv[3] || '1' });
  for (const r of res) {
    const uniq = [...new Set([...r.A, ...r.B])];
    const changesA = r.A.filter((c, i) => i === 0 || c !== r.A[i - 1]).length;
    console.log(
      r.name.padEnd(18),
      `costumes used ${uniq.length}`,
      `| A changes ${changesA}`,
      `| sndA ${r.soundsA.map((s) => s.sound + '@' + s.t.toFixed(2)).join(',')}`,
      `| sndB ${r.soundsB.map((s) => s.sound + '@' + s.t.toFixed(2)).join(',')}`,
      r.warnings.length ? `| WARN ${r.warnings.join('; ')}` : ''
    );
  }
}
