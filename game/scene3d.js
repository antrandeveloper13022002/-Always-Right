'use strict';
// Decorative 3D booth, drawn with three.js (pinned CDN build in index.html):
// a night-shift kiosk on a rainy plaza. Optional: without three.js or WebGL,
// init() returns false and the page shows a flat backdrop instead.
// No game rule lives in this file.

const Scene3D = (() => {
  const T = window.THREE;
  const ADDONS = window.THREE_ADDONS || {};
  const isCalm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SANS = '"Be Vietnam Pro", "Segoe UI", system-ui, sans-serif';
  const MONO = '"JetBrains Mono", Consolas, monospace';
  const SPOT_X = 0.08;          // where a customer stands, outside the window
  const SPOT_Z = -0.74;
  const LEDGE_DEPTH = 0.58;  // outer counter, from the glass outwards
  // The service window: opening x ∈ [-WIN.half, WIN.half], y ∈ [WIN.bottom, WIN.top].
  const WIN = { half: 1.25, bottom: 0.8, top: 2.12, glassZ: -0.08 };
  const ENTER_X = -3.2;
  const EXIT_X = 3.4;
  // Everything worth seeing sits inside this rectangle on the window wall (z = 0).
  const FRAME = { top: 2.5, bottom: 0.68, wideHalf: 2.2, narrowHalf: 1.3 };
  const CAM_RISE = 0.22;   // camera sits above the frame centre and looks down a little
  const SCREEN = {
    idle: { color: '#3fd8ff', text: 'SẴN SÀNG' },
    talk: { color: '#3fd8ff', text: 'ĐANG SOẠN PHẢN HỒI' },
    ok: { color: '#4ade80', text: 'ĐÃ DUYỆT · ĐÃ GỬI' },
    error: { color: '#ff4d5e', text: 'LỖI ĐÃ LỌT RA NGOÀI' },
    blocked: { color: '#f5a524', text: 'THÔNG TIN ĐÚNG BỊ CHẶN' },
    refused: { color: '#f5a524', text: 'ĐÃ TỪ CHỐI PHỤC VỤ' },
  };

  let isReady = false;
  let renderer; let scene; let camera; let view;
  const camHome = { x: 0, y: 1.57, z: 2 };
  const matCache = new Map();
  const tweens = [];
  const idlers = [];
  const texts = [];
  let glowTexture;
  let customer = null;
  let mira = null;
  let beacon = null;
  let printer = null;
  let clock = null;
  let rain = null;
  let screenState = 'idle';
  let screenKey = '';
  let talkFrom = 0;
  let talkUntil = 0;
  let beaconColor = 0xff3344;
  let beaconUntil = 0;
  let shakeLeft = 0;
  let elapsed = 0;
  let onAnchor = null;
  let focus = 0;          // 0 = whole booth, 1 = close on the customer's face
  let focusGoal = 0;
  let baseFov = 40;
  let closeLight = null;
  const lookBase = T ? new T.Vector3() : null;
  const lookNow = T ? new T.Vector3() : null;
  const camNow = T ? new T.Vector3() : null;
  const leaving = new Set();     // people walking away (still animated)
  const modelLoads = new Map();   // name -> Promise
  const models = new Map();       // name -> loaded glTF
  let cracks = null;      // canvas texture on the window glass
  const crackList = [];   // { u, v, rays } in canvas pixels
  const debris = [];      // paper balls left on the ledge
  let trayPaper = null;   // the sheet that slides through the document tray
  const headPos = T ? new T.Vector3() : null;
  let composer = null;    // post-processing chain (null = plain render)
  let bloomPass = null;
  let gradePass = null;
  const perf = { n: 0, sum: 0 };

  // ---- Building blocks ---------------------------------------------------
  const sph = (r, w = 32, h = 24) => new T.SphereGeometry(r, w, h);
  const shell = (r, cover, start = 0) => new T.SphereGeometry(r, 40, 20, 0, Math.PI * 2, Math.PI * start, Math.PI * cover);
  const capsule = (r, len) => new T.CapsuleGeometry(r, len, 10, 20);
  const cyl = (top, bottom, h, s = 28) => new T.CylinderGeometry(top, bottom, h, s);
  const box = (x, y, z) => new T.BoxGeometry(x, y, z);
  // Sound lives in audio.js; the booth only says what happened, and when.
  const sound = (name, delay) => { if (window.GameAudio) window.GameAudio.sfx(name, delay); };
  const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
  const smooth = (a, b, k) => Math.min(1, Math.max(0, (k - a) / (b - a)));

  function std(color, rough = 0.7, metal = 0, extra = {}) {
    const key = `${color}|${rough}|${metal}|${JSON.stringify(extra)}`;
    if (!matCache.has(key)) {
      matCache.set(key, new T.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));
    }
    return matCache.get(key);
  }

  function lit(color) {
    const key = `lit|${color}`;
    if (!matCache.has(key)) matCache.set(key, new T.MeshBasicMaterial({ color }));
    return matCache.get(key);
  }

  function mesh(geo, material, { at, rot, scale, parent, cast = false } = {}) {
    const m = new T.Mesh(geo, material);
    if (at) m.position.set(...at);
    if (rot) m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    m.castShadow = cast;
    m.receiveShadow = true;
    (parent || scene).add(m);
    return m;
  }

  function group(at, parent) {
    const g = new T.Group();
    if (at) g.position.set(...at);
    (parent || scene).add(g);
    return g;
  }

  function canvasTexture(w, h, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const texture = new T.CanvasTexture(canvas);
    texture.encoding = T.sRGBEncoding;
    texture.anisotropy = 4;
    const redraw = (...args) => {
      draw(canvas.getContext('2d'), w, h, ...args);
      texture.needsUpdate = true;
    };
    redraw();
    return { texture, redraw };
  }

  // A printed or lit flat surface. Lit ones (signs, screens) ignore lighting.
  function plate(width, height, px, draw, at, { isLit = false, parent, rot } = {}) {
    const tex = canvasTexture(px, Math.round((px * height) / width), draw);
    const material = isLit
      ? new T.MeshBasicMaterial({ map: tex.texture, toneMapped: false })
      : new T.MeshStandardMaterial({ map: tex.texture, roughness: 0.9 });
    const m = mesh(new T.PlaneGeometry(width, height), material, { at, rot, parent });
    texts.push(tex.redraw);
    return { mesh: m, redraw: tex.redraw };
  }

  function glow(color, size, at, parent, opacity = 0.8) {
    const sprite = new T.Sprite(new T.SpriteMaterial({
      map: glowTexture, color, transparent: true, opacity, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
    }));
    sprite.position.set(...at);
    sprite.scale.setScalar(size);
    (parent || scene).add(sprite);
    return sprite;
  }

  function makeGlowTexture() {
    return canvasTexture(128, 128, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }).texture;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // ---- Motion ------------------------------------------------------------
  // A keyed tween replaces any running tween with the same key.
  function tween(key, dur, update, done, delay = 0) {
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].key === key) tweens.splice(i, 1);
    if (isCalm || (dur <= 0 && delay <= 0)) {
      update(1);
      if (done) done();
      return;
    }
    tweens.push({ key, dur: Math.max(dur, 0.001), age: -delay, update, done });
  }

  function runTweens(dt) {
    for (const tw of tweens.slice()) {
      tw.age += dt;
      if (tw.age < 0) continue;
      const k = Math.min(1, tw.age / tw.dur);
      tw.update(k);
      if (k >= 1) {
        tweens.splice(tweens.indexOf(tw), 1);
        if (tw.done) tw.done();
      }
    }
  }

  // ---- People ------------------------------------------------------------
  // Dark soft patch on the ledge under the customer's chest: grounds them.
  let shadowTexture = null;
  function addContactShadow(root) {
    if (!shadowTexture) {
      shadowTexture = canvasTexture(128, 64, (g, w, h) => {
        const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        grad.addColorStop(0, 'rgba(0,0,0,0.6)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      }).texture;
    }
    const patch = mesh(new T.PlaneGeometry(0.75, 0.32), new T.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }), {
      at: [0, WIN.bottom + 0.022, 0.15], rot: [-Math.PI / 2, 0, 0], parent: root,
    });
    patch.receiveShadow = false;
  }

  function buildPerson(look) {
    if (look.model && models.has(look.model)) return buildModelPerson(look);
    const build = look.build || 1;
    const root = group([ENTER_X, 0, SPOT_Z]);
    root.scale.setScalar(look.height || 1);
    const body = group(null, root);
    const skin = std(look.skin, 0.55);
    const cloth = std(look.top, 0.85);
    const clothDark = std(new T.Color(look.top).multiplyScalar(0.6).getHex(), 0.85);
    const hair = std(look.hair, 0.5);

    mesh(capsule(0.17, 0.42), cloth, { at: [0, 1.2, 0], scale: [1.25 * build, 1, 0.78], parent: body });
    mesh(new T.TorusGeometry(0.075, 0.028, 12, 28), clothDark, { at: [0, 1.535, 0.005], rot: [Math.PI / 2, 0, 0], parent: body });
    mesh(cyl(0.048, 0.055, 0.14), skin, { at: [0, 1.6, 0], parent: body });
    // Arms hang from a shoulder pivot so they can swing (index 0 = left, 1 = right).
    const hands = [];
    const arms = [-1, 1].map((s) => {
      const arm = group([s * 0.235 * build, 1.42, 0.01], body);
      arm.rotation.z = s * 0.07;
      mesh(capsule(0.056, 0.42), cloth, { at: [0, -0.23, 0], parent: arm });
      hands.push(mesh(sph(0.048, 20, 14), skin, { at: [0.015 * s, -0.5, 0.01], scale: [0.85, 1.1, 0.8], parent: arm }));
      return arm;
    });

    const head = group([0, 1.745, 0], body);
    mesh(sph(0.115), skin, { scale: [0.92, 1.05, 1], parent: head });
    mesh(sph(0.09), skin, { at: [0, -0.05, 0.016], scale: [0.88, 0.85, 0.95], parent: head });
    for (const s of [-1, 1]) mesh(sph(0.024, 16, 12), skin, { at: [s * 0.104, -0.005, 0], scale: [0.5, 1, 0.8], parent: head });
    mesh(sph(0.018, 16, 12), skin, { at: [0, -0.024, 0.113], scale: [0.8, 1, 1.05], parent: head });

    const eyes = [-1, 1].map((s) => {
      const eye = group([s * 0.04, 0.01, 0.096], head);
      mesh(sph(0.017, 20, 14), std('#f4f1ea', 0.25), { parent: eye });
      mesh(sph(0.0095, 16, 12), std('#2b1d14', 0.2), { at: [0, 0, 0.012], parent: eye });
      mesh(sph(0.003, 8, 6), lit('#ffffff'), { at: [0.004, 0.004, 0.0195], parent: eye });
      return eye;
    });
    const browY = 0.043;
    const brows = [-1, 1].map((s) => mesh(capsule(0.0055, 0.03), hair, {
      at: [s * 0.041, browY, 0.104], rot: [0, 0, Math.PI / 2], parent: head,
    }));

    const mouthZ = look.beard ? 0.112 : 0.103;
    const lips = std('#9a5a52', 0.45);
    const mouth = {
      flat: mesh(capsule(0.006, 0.026), lips, { at: [0, -0.058, mouthZ], rot: [0, 0, Math.PI / 2], parent: head }),
      arc: mesh(new T.TorusGeometry(0.019, 0.0055, 10, 24, Math.PI), lips, { at: [0, -0.052, mouthZ], parent: head }),
      o: mesh(new T.TorusGeometry(0.011, 0.005, 10, 20), std('#4a2420', 0.5), { at: [0, -0.06, mouthZ], parent: head }),
    };

    if (look.style === 'bald') {
      mesh(shell(0.119, 0.2, 0.4), hair, { at: [0, 0, -0.004], parent: head });
    } else {
      // Hairline high at the front, low at the back.
      mesh(shell(look.style === 'buzz' ? 0.119 : 0.123, 0.5), hair, { at: [0, 0.008, -0.006], rot: [-0.55, 0, 0], parent: head });
    }
    if (look.style === 'long') {
      mesh(capsule(0.1, 0.2), hair, { at: [0, -0.11, -0.06], scale: [1.12, 1, 0.6], parent: head });
      for (const s of [-1, 1]) mesh(capsule(0.03, 0.16), hair, { at: [s * 0.1, -0.07, 0], parent: head });
    } else if (look.style === 'bob') {
      mesh(capsule(0.1, 0.05), hair, { at: [0, -0.045, -0.05], scale: [1.18, 1, 0.75], parent: head });
      for (const s of [-1, 1]) mesh(capsule(0.032, 0.07), hair, { at: [s * 0.105, -0.045, 0.012], parent: head });
    } else if (look.style === 'bun') {
      mesh(sph(0.052), hair, { at: [0, 0.06, -0.125], parent: head });
      for (const s of [-1, 1]) mesh(sph(0.05, 20, 14), hair, { at: [s * 0.088, 0.01, -0.03], scale: [0.6, 1, 1.1], parent: head });
    } else if (look.style === 'ponytail') {
      mesh(capsule(0.028, 0.16), hair, { at: [0, -0.07, -0.13], rot: [0.35, 0, 0], parent: head });
    }

    if (look.beard) mesh(sph(0.095), std(look.beard, 0.6), { at: [0, -0.062, 0.022], scale: [0.95, 0.72, 0.9], parent: head });
    if (look.mustache) {
      mesh(capsule(0.008, 0.042), std(look.mustache, 0.6), { at: [0, -0.042, 0.11], rot: [0, 0, Math.PI / 2], parent: head });
    }
    if (look.glasses) {
      const frame = std('#1b1d21', 0.3, 0.8);
      for (const s of [-1, 1]) {
        mesh(new T.TorusGeometry(0.021, 0.0028, 10, 28), frame, { at: [s * 0.04, 0.01, 0.114], parent: head });
        mesh(box(0.003, 0.003, 0.1), frame, { at: [s * 0.062, 0.012, 0.065], parent: head });
      }
      mesh(box(0.016, 0.003, 0.003), frame, { at: [0, 0.014, 0.116], parent: head });
    }
    if (look.hat === 'cap') {
      const felt = std(look.hatColor, 0.8);
      mesh(shell(0.127, 0.5), felt, { at: [0, 0.014, -0.004], rot: [-0.12, 0, 0], parent: head });
      mesh(cyl(0.075, 0.075, 0.008), felt, { at: [0, 0.035, 0.112], rot: [0.18, 0, 0], scale: [1, 1, 0.9], parent: head });
    } else if (look.hat === 'beanie') {
      const knit = std(look.hatColor, 0.95);
      mesh(shell(0.128, 0.55), knit, { at: [0, 0.012, -0.004], rot: [-0.15, 0, 0], scale: [1, 1.12, 1], parent: head });
      mesh(new T.TorusGeometry(0.118, 0.018, 12, 40), knit, { at: [0, 0.03, -0.004], rot: [Math.PI / 2 - 0.15, 0, 0], parent: head });
    }
    if (look.old) {
      body.rotation.x = 0.05;
      head.rotation.x = 0.06;
    }

    const flushMat = new T.MeshBasicMaterial({ color: 0xd83a3a, transparent: true, opacity: 0.5, depthWrite: false });
    const flush = [-1, 1].map((s) => mesh(sph(0.03, 16, 12), flushMat, { at: [s * 0.058, -0.028, 0.093], scale: [1.3, 0.7, 0.45], parent: head }));
    addContactShadow(root);
    const person = { root, body, head, arms, hands, flush, eyes, brows, browY, mouth, eyeOpen: 1 };
    setMood(person, 'calm');
    return person;
  }

  // calm | pleased | shocked | annoyed
  function setMood(person, mood) {
    if (person.rig) {
      person.mood = mood;
      return;
    }
    person.mouth.flat.visible = mood === 'calm';
    const isAngry = mood === 'angry';
    person.mouth.arc.visible = mood === 'pleased' || mood === 'annoyed' || isAngry;
    person.mouth.arc.rotation.z = mood === 'pleased' ? Math.PI : 0;
    person.mouth.o.visible = mood === 'shocked';
    const tilt = isAngry ? 0.6 : mood === 'annoyed' ? 0.32 : 0;
    const lift = mood === 'shocked' ? 0.01 : isAngry ? -0.008 : mood === 'annoyed' ? -0.004 : 0;
    for (const cheek of person.flush) cheek.visible = isAngry;
    person.brows[0].rotation.z = Math.PI / 2 - tilt;
    person.brows[1].rotation.z = Math.PI / 2 + tilt;
    for (const brow of person.brows) brow.position.y = person.browY + lift;
    person.eyeOpen = mood === 'shocked' ? 1.25 : mood === 'pleased' ? 0.7 : isAngry ? 0.8 : 1;
  }

  // ---- Model people (GLB built by art/scripts/build_character.py) --------
  function loadModel(name) {
    if (!ADDONS.GLTFLoader) return Promise.reject(new Error('no GLTFLoader'));
    if (!modelLoads.has(name)) {
      modelLoads.set(name, new Promise((resolve, reject) => {
        new ADDONS.GLTFLoader().load(`models/${name}.glb`, (gltf) => {
          models.set(name, gltf);
          resolve(gltf);
        }, undefined, reject);
      }));
    }
    return modelLoads.get(name);
  }

  // Facial poses as bone offsets in model space (metres, +Y up, +Z towards
  // the clerk) and a jaw angle. Bones found with art/scripts/face_bones.py
  // (three.js drops the '.' in bone names: upperarm01.L is upperarm01L here).
  const FACES = {
    calm: { jaw: 0 },
    pleased: { jaw: 0.04, 'risorius03': [0.003, 0.004, 0], 'orbicularis04': [0, 0.0015, 0], 'oculi01': [0, 0.002, 0] },
    shocked: { jaw: 0.22, 'oculi01': [0, 0.007, 0], 'orbicularis03': [0, 0.0025, 0] },
    annoyed: { jaw: 0, 'oculi01': [0, -0.004, 0], 'oris07': [0, -0.002, 0], 'risorius03': [0, -0.002, 0] },
    angry: { jaw: 0.08, 'oculi01': [-0.005, -0.008, 0.005], 'orbicularis03': [0, -0.0008, 0], 'orbicularis04': [0, 0.0012, 0], 'risorius03': [0.004, -0.007, 0], 'oris07': [0, -0.006, 0], 'levator06': [0.001, 0.005, 0.002] },
  };
  const FACE_BONES = ['oculi01', 'orbicularis03', 'orbicularis04', 'risorius03', 'oris07', 'levator06'];
  const AXIS_X = T ? new T.Vector3(1, 0, 0) : null;
  const AXIS_Z = T ? new T.Vector3(0, 0, 1) : null;
  const UP = T ? new T.Vector3(0, 1, 0) : null;

  // Everything needed to drive one bone relative to its rest pose.
  function boneRest(bone) {
    const parentQ = bone.parent.getWorldQuaternion(new T.Quaternion());
    const toLocal = new T.Matrix3().setFromMatrix4(new T.Matrix4().copy(bone.parent.matrixWorld).invert());
    return { bone, q: bone.quaternion.clone(), p: bone.position.clone(), parentQ, parentInv: parentQ.clone().invert(), toLocal };
  }

  // Rotate a bone by a model-space quaternion, keeping its rest orientation.
  function turnBone(rest, modelQ) {
    rest.bone.quaternion.copy(rest.parentInv).multiply(modelQ).multiply(rest.parentQ).multiply(rest.q);
  }

  // Skin: physical material with a soft sheen (peach fuzz) that catches the
  // rim light, so faces stop looking like painted plastic.
  function toSkin(src) {
    const skin = new T.MeshPhysicalMaterial();
    T.MeshStandardMaterial.prototype.copy.call(skin, src);
    skin.defines = { STANDARD: '', PHYSICAL: '' };
    skin.roughness = Math.max(0.55, Math.min(src.roughness, 0.68));
    skin.sheen = 0.25;
    skin.sheenRoughness = 0.5;
    skin.sheenColor.setRGB(0.9, 0.55, 0.42);
    return skin;
  }

  function buildModelPerson(look) {
    const model = ADDONS.SkeletonUtils.clone(models.get(look.model).scene);
    const root = group([ENTER_X, 0, SPOT_Z]);
    addContactShadow(root);
    const body = group(null, root);
    body.add(model);
    const bones = {};
    let skin = null;
    model.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      const mat = o.material;
      if (mat.map && (mat.transparent || mat.alphaTest > 0)) {
        // Hair cards, brows, lashes: cut-out instead of sorted blending.
        mat.transparent = false;
        mat.alphaTest = 0.22;
        mat.alphaToCoverage = true;   // soft strand edges on the multisampled frame
        mat.depthWrite = true;
        mat.side = T.DoubleSide;
      }
      if (/low-poly$/i.test(mat.name)) {
        // Wet eyes: a sharp catchlight makes the face read as alive.
        o.material = mat.clone();
        o.material.roughness = 0.06;
        o.material.metalness = 0;
      }
      if (/\.body$/i.test(o.name)) {
        o.material = toSkin(mat);
        skin = o.material;
      }
    });
    model.updateMatrixWorld(true);

    const limb = (upper, lower, sign) => {
      const rest = boneRest(bones[upper]);
      const from = bones[upper].getWorldPosition(new T.Vector3());
      const to = bones[lower].getWorldPosition(new T.Vector3());
      const restDir = to.sub(from).normalize();
      const downDir = new T.Vector3(sign * 0.13, -1, 0.07).normalize();
      rest.qDown = new T.Quaternion().setFromUnitVectors(restDir, downDir);
      return rest;
    };
    // Index 0 is the arm on the -X side, as for the primitive figure.
    const rigArms = [limb('upperarm01R', 'lowerarm01R', -1), limb('upperarm01L', 'lowerarm01L', 1)];
    const rigLegs = ['upperleg01R', 'upperleg01L'].map((name) => boneRest(bones[name]));
    // Elbows and eyes are driven in their own local frames.
    const elbows = ['lowerarm01R', 'lowerarm01L'].map((name) => ({ bone: bones[name], q: bones[name].quaternion.clone() }));
    const eyes = ['eyeR', 'eyeL'].filter((name) => bones[name]).map((name) => ({ bone: bones[name], q: bones[name].quaternion.clone() }));
    // Finger joints, curled into a fist when angry (rotation about the bone's local X).
    const fingers = Object.values(bones).filter((b) => /^finger[1-5]-[1-3][LR]$/.test(b.name))
      .map((bone) => ({ bone, q: bone.quaternion.clone(), curl: bone.name.startsWith('finger1') ? 0.5 : 1.25 }));
    const chest = bones.spine02 ? boneRest(bones.spine02) : null;
    const clavicles = [['clavicleR', -1], ['clavicleL', 1]].filter(([n]) => bones[n]).map(([n, side]) => Object.assign(boneRest(bones[n]), { side }));
    const face = {};
    for (const base of FACE_BONES) {
      for (const [name, side] of [[base, 0], [`${base}L`, 1], [`${base}R`, -1]]) if (bones[name]) face[name] = Object.assign(boneRest(bones[name]), { base, side });
    }

    const person = {
      root, body,
      head: new T.Object3D(),                    // controllers, read every frame
      arms: [new T.Object3D(), new T.Object3D()],
      legs: [new T.Object3D(), new T.Object3D()],
      hands: [bones.wristR, bones.wristL],
      armLen: bones.upperarm01L.getWorldPosition(new T.Vector3()).distanceTo(bones.wristL.getWorldPosition(new T.Vector3())),
      anchor: bones.head,
      eyes: [], flush: [], eyeOpen: 1,
      rig: {
        arms: rigArms, legs: rigLegs, face, skin,
        head: boneRest(bones.head), jaw: bones.jaw ? boneRest(bones.jaw) : null,
        faceNow: {}, jawNow: 0, flushNow: 0, blinkAt: 2 + Math.random() * 3,
        fingers, fistNow: 0, rageNow: 0, elbows, eyes, chest, clavicles,
        glanceAt: 3 + Math.random() * 4, glance: new T.Vector2(), glanceGoal: new T.Vector2(),
        sway: Math.random() * 10,
      },
      mood: 'calm',
      shoutUntil: 0,
      talkUntil: 0,
      readyAt: 0,          // no gestures before this (walking in)
      gesture: null, gestureAt: 1.5 + Math.random(), lastGesture: '',
      gest: { arm: [0, 0], elbow: [0, 0], shrug: 0, roll: 0, pitch: 0 },
    };
    if (look.glasses) addGlasses(person, bones);
    dress(model, look);
    person.tired = Boolean(look.tired);
    person.wet = Boolean(look.wet);
    person.drips = person.wet ? [] : null;
    person.dripAt = 0.6;
    person.umbrella = addUmbrella(person, look);
    person.hold = person.umbrella ? 1 : 0;   // walks in holding it up
    applyRig(person, 0);
    return person;
  }

  // ---- Weather on people -------------------------------------------------
  // Soaked clothes are darker and glossy, hair is slick; look.outfit tints
  // the clothes (a new jacket, a faded one).
  function dress(model, look) {
    if (!look.wet && !look.outfit) return;
    const tint = look.outfit ? new T.Color(look.outfit) : null;
    model.traverse((o) => {
      if (!o.isMesh || /\.body$/i.test(o.name) || /low-poly$|teeth|eyelash|eyebrow/i.test(o.material.name)) return;
      const isHair = o.material.alphaTest > 0;
      const mat = o.material.clone();
      if (tint && !isHair) mat.color.multiply(tint);
      if (look.wet) {
        mat.color.multiplyScalar(isHair ? 0.8 : 0.68);
        mat.roughness = isHair ? 0.28 : 0.34;
      }
      o.material = mat;
    });
  }

  // Most people come in from the rain under an umbrella: open overhead while
  // walking, folded away at the window. Soaked people had none.
  const UMBRELLAS = ['#15171c', '#1d2a44', '#7a1f2b', 'clear', '#2c4a3a', 'clear', '#3b2f4a'];
  function addUmbrella(person, look) {
    if (look.umbrella === false || (look.wet && !look.umbrella)) return null;
    const seed = [...(look.model || '')].reduce((n, c) => n * 31 + c.charCodeAt(0), 7) >>> 0;
    if (!look.umbrella && seed % 10 >= 6) return null;
    const color = look.umbrella || UMBRELLAS[seed % UMBRELLAS.length];
    const isClear = color === 'clear';
    const cloth = isClear
      ? new T.MeshStandardMaterial({ color: 0xdfe9f2, roughness: 0.06, transparent: true, opacity: 0.32, depthWrite: false, side: T.DoubleSide })
      : new T.MeshStandardMaterial({ color, roughness: 0.3, side: T.DoubleSide });
    const u = group(null, person.root);
    const canopy = group([0, 0.5, 0], u);
    mesh(new T.SphereGeometry(0.52, 32, 10, 0, Math.PI * 2, 0, Math.PI * 0.36), cloth, { parent: canopy, scale: [1, 0.55, 1], cast: !isClear });
    const steel = std('#9aa1a8', 0.3, 0.9);
    for (let i = 0; i < 8; i++) {   // rib tips peeking under the rim
      const a = (i / 8) * Math.PI * 2;
      mesh(sph(0.011, 8, 6), steel, { at: [Math.cos(a) * 0.47, 0.08, Math.sin(a) * 0.47], parent: canopy });
    }
    const shaft = mesh(cyl(0.006, 0.006, 1, 8), steel, { parent: u });
    mesh(cyl(0.004, 0.009, 0.07, 8), steel, { parent: canopy, at: [0, 0.32, 0] });
    mesh(new T.TorusGeometry(0.035, 0.009, 8, 16, Math.PI), std('#2a1d16', 0.5), { at: [0.035, 0, 0], rot: [0, 0, Math.PI], parent: u });
    return { group: u, canopy, shaft, open: 1 };
  }

  function setUmbrella(person, isOpen, dur) {
    const u = person.umbrella;
    if (!u) return;
    if (isOpen) u.group.visible = true;
    sound('umbrella');
    const from = u.open;
    tween(`umbrella${person.root.id}`, dur, (k) => {
      u.open = from + ((isOpen ? 1 : 0) - from) * k;
      person.hold = isOpen ? Math.max(person.hold, smooth(0, 0.4, k)) : 1 - smooth(0.6, 1, k);
    }, () => { if (!isOpen) u.group.visible = false; });
  }

  function updateWeather(person, dt) {
    const u = person.umbrella;
    if (u && u.group.visible) {
      // The shaft runs from the hand to just above the head, whichever way they face.
      person.hands[1].getWorldPosition(vTmp);
      person.anchor.getWorldPosition(headPos);
      headPos.y += 0.36;
      person.root.worldToLocal(vTmp);
      person.root.worldToLocal(headPos);
      u.group.position.copy(vTmp);
      headPos.sub(vTmp);
      const reachUp = Math.max(0.3, headPos.length());
      u.group.quaternion.setFromUnitVectors(UP, headPos.normalize());
      u.canopy.position.y = reachUp;
      u.shaft.scale.y = reachUp;
      u.shaft.position.y = reachUp / 2;
      u.canopy.scale.set(0.14 + 0.86 * u.open, 1 + 1.3 * (1 - u.open), 0.14 + 0.86 * u.open);
    }
    if (person.drips && !isCalm) {
      person.dripAt -= dt;
      if (person.dripAt < 0 && person.drips.length < 4) {
        person.dripAt = 0.35 + Math.random() * 0.6;
        person.anchor.getWorldPosition(vTmp);
        const drop = glow(0xcfe0ff, 0.022, [vTmp.x + (Math.random() - 0.5) * 0.14, vTmp.y - 0.02 - Math.random() * 0.12, vTmp.z + 0.04], null, 0.85);
        drop.v = 0;
        person.drips.push(drop);
      }
      for (const drop of [...person.drips]) {
        drop.v += 9.8 * dt;
        drop.position.y -= drop.v * dt;
        if (drop.position.y < WIN.bottom) {
          scene.remove(drop);
          person.drips.splice(person.drips.indexOf(drop), 1);
        }
      }
    }
  }

  function addGlasses(person, bones) {
    const left = bones.eyeL.getWorldPosition(new T.Vector3());
    const right = bones.eyeR.getWorldPosition(new T.Vector3());
    const frame = std('#1b1d21', 0.3, 0.8);
    const glasses = new T.Group();
    scene.add(glasses);
    glasses.position.copy(left).add(right).multiplyScalar(0.5);
    glasses.position.z += 0.028;
    const gap = left.distanceTo(right) / 2;
    for (const s of [-1, 1]) {
      mesh(new T.TorusGeometry(0.017, 0.0022, 10, 28), frame, { at: [s * gap, 0, 0], parent: glasses });
      mesh(box(0.0025, 0.0025, 0.085), frame, { at: [s * (gap + 0.018), 0.003, -0.042], parent: glasses });
    }
    mesh(box(gap * 2 - 0.034, 0.0025, 0.0025), frame, { at: [0, 0.004, 0], parent: glasses });
    bones.head.attach(glasses);
  }

  const qTmp = T ? new T.Quaternion() : null;
  const eTmp = T ? new T.Euler() : null;
  const vTmp = T ? new T.Vector3() : null;

  // ---- Gestures ------------------------------------------------------------
  // Small additive moves layered on the rig while a calm customer talks (and,
  // rarely, while they wait). Each returns offsets for envelope e (0..1) and
  // local time k. arm < 0 lifts an arm forward; elbow > 0 bends it up.
  const GESTURES = {
    explain: { dur: 1.7, talk: true, pose: (g, e, k, side) => {
      g.arm[side] = -0.42 * e;
      g.elbow[side] = (1.05 + 0.14 * Math.sin(k * Math.PI * 5)) * e;   // beats with the words
      g.roll = 0.035 * e * (side ? 1 : -1);
    } },
    open: { dur: 1.4, talk: true, pose: (g, e) => {
      g.arm[0] = g.arm[1] = -0.24 * e;
      g.elbow[0] = g.elbow[1] = 0.75 * e;
      g.shrug = 0.03 * e;
    } },
    shrug: { dur: 1.1, talk: true, pose: (g, e, k, side) => {
      g.shrug = 0.13 * e;
      g.elbow[0] = g.elbow[1] = 0.3 * e;
      g.roll = 0.07 * e * (side ? 1 : -1);
      g.pitch = -0.03 * e;
    } },
    tilt: { dur: 1.8, talk: true, idle: true, pose: (g, e, k, side) => { g.roll = 0.09 * e * (side ? 1 : -1); } },
    look: { dur: 1.5, idle: true, pose: (g, e) => { g.pitch = 0.2 * e; } },   // glance down at the tray
  };
  const TALK_MOVES = Object.keys(GESTURES).filter((k) => GESTURES[k].talk);
  const IDLE_MOVES = Object.keys(GESTURES).filter((k) => GESTURES[k].idle);

  function updateGesture(person, dt) {
    const g = person.gest;
    g.arm[0] = g.arm[1] = g.elbow[0] = g.elbow[1] = 0;
    g.shrug = g.roll = g.pitch = 0;
    const busy = isCalm || person !== customer || person.mood === 'angry' || elapsed < person.readyAt || person.hold > 0
      || tweens.some((tw) => tw.key === 'act' || tw.key === 'head');
    const now = person.gesture;
    if (now) {
      const k = (elapsed - now.t0) / GESTURES[now.kind].dur;
      if (k >= 1 || busy) {
        person.gesture = null;
      } else {
        GESTURES[now.kind].pose(g, smooth(0, 0.28, k) * (1 - smooth(0.68, 1, k)), k, now.side);
      }
      return;
    }
    if (busy) return;
    person.gestureAt -= dt;
    if (person.gestureAt > 0) return;
    const isTalking = elapsed < person.talkUntil;
    const moves = (isTalking ? TALK_MOVES : IDLE_MOVES).filter((m) => m !== person.lastGesture);
    const kind = pickOne(moves);
    person.lastGesture = kind;
    person.gesture = { kind, t0: elapsed, side: Math.random() < 0.5 ? 0 : 1 };
    person.gestureAt = isTalking ? 0.4 + Math.random() * 1.2 : 4 + Math.random() * 5;
  }
  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

  // Pose the skeleton from the controllers and ease the face towards the mood.
  function applyRig(person, dt) {
    const rig = person.rig;
    updateGesture(person, dt);
    const gest = person.gest;
    if (person.hold) {   // forearm up, holding the umbrella shaft
      gest.arm[1] += -0.5 * person.hold;
      gest.elbow[1] += 1.45 * person.hold;
    }
    if (person.tired) {   // head hangs, shoulders drop
      gest.pitch += 0.13;
      gest.shrug -= 0.04;
    }
    updateWeather(person, dt);
    rig.arms.forEach((rest, i) => {
      // Arms hang close to the body: the hands stay behind the counter lip
      // instead of sinking into the counter top.
      qTmp.setFromAxisAngle(AXIS_X, person.arms[i].rotation.x - 0.04 + gest.arm[i]).multiply(rest.qDown);
      turnBone(rest, qTmp);
    });
    rig.legs.forEach((rest, i) => turnBone(rest, qTmp.setFromAxisAngle(AXIS_X, person.legs[i].rotation.x)));
    const goal = FACES[person.mood] || FACES.calm;
    const ease = isCalm ? 1 : Math.min(1, dt * 8);
    const isAngry = person.mood === 'angry';
    rig.rageNow += ((isAngry ? 1 : 0) - rig.rageNow) * Math.min(1, dt * 4);
    const rage = isCalm ? 0 : rig.rageNow;
    const isShouting = isAngry && elapsed < person.shoutUntil;
    // Head juts forward and shakes while ranting.
    const h = person.head.rotation;
    const shake = isShouting ? Math.sin(elapsed * 7.5) * 0.09 : 0;
    const nod = elapsed < person.talkUntil ? Math.sin(elapsed * 2.6) * 0.035 : 0;
    // Nobody holds their head perfectly still: two slow, unrelated drifts.
    const s = rig.sway;
    const driftX = isCalm ? 0 : Math.sin(s * 0.71) * 0.014 + Math.sin(s * 1.93 + 1) * 0.005;
    const driftY = isCalm ? 0 : Math.sin(s * 0.53 + 2) * 0.02 + Math.sin(s * 1.37) * 0.006;
    turnBone(rig.head, qTmp.setFromEuler(eTmp.set(h.x + 0.08 * rage + nod + rig.glance.y * 0.3 + driftX + gest.pitch, h.y + shake + rig.glance.x * 0.35 + driftY, h.z + gest.roll)));
    person.root.rotation.x = 0.07 * rage + (person.tired ? 0.035 : 0);
    // Breathing in the chest and shoulders (heavy when angry).
    const breath = Math.sin(elapsed * (1.7 + 4 * rage)) * 0.5 + 0.5;
    if (rig.chest) turnBone(rig.chest, qTmp.setFromAxisAngle(AXIS_X, -(0.012 + 0.03 * rage) * breath));
    for (const c of rig.clavicles) turnBone(c, qTmp.setFromAxisAngle(AXIS_Z, c.side * ((0.02 + 0.05 * rage) * breath + gest.shrug)));
    // Fists.
    rig.fistNow += ((isAngry ? 1 : 0) - rig.fistNow) * ease;
    for (const f of rig.fingers) f.bone.quaternion.copy(f.q).multiply(qTmp.setFromAxisAngle(AXIS_X, f.curl * (0.28 + 0.72 * rig.fistNow)));
    // Elbows soften a little (more when the arms are raised).
    rig.elbows.forEach((e, i) => {
      const bend = 0.22 + 0.25 * Math.min(1, Math.abs(person.arms[i].rotation.x)) + gest.elbow[i];
      e.bone.quaternion.copy(e.q).multiply(qTmp.setFromAxisAngle(AXIS_X, bend));
    });
    // Eye contact with the clerk (the camera), with the odd glance away.
    rig.glanceAt -= dt;
    if (rig.glanceAt < 0) {
      const away = !isAngry && Math.random() < 0.45;
      rig.glanceGoal.set(away ? (Math.random() - 0.5) * 0.5 : 0, away ? -0.12 - Math.random() * 0.15 : 0);
      rig.glanceAt = away ? 0.8 + Math.random() : 2.5 + Math.random() * 3;
    }
    rig.glance.lerp(rig.glanceGoal, Math.min(1, dt * 6));
    if (rig.eyes.length) {
      rig.eyes[0].bone.parent.getWorldPosition(vTmp);
      const dx = camera.position.x - vTmp.x;
      const dy = camera.position.y - vTmp.y;
      const dz = Math.max(0.3, camera.position.z - vTmp.z);
      const yaw = Math.max(-0.35, Math.min(0.35, Math.atan2(dx, dz) - person.head.rotation.y - person.root.rotation.y)) + rig.glance.x;
      const pitch = Math.max(-0.3, Math.min(0.3, Math.atan2(dy, dz))) + rig.glance.y;
      for (const e of rig.eyes) e.bone.quaternion.copy(e.q).multiply(qTmp.setFromEuler(eTmp.set(-pitch, 0, yaw, 'YXZ')));
    }
    // Slow weight shift from foot to foot.
    if (!isCalm) {
      rig.sway += dt;
      person.body.position.x = Math.sin(rig.sway * 0.45) * 0.012;
      person.body.rotation.z = Math.sin(rig.sway * 0.45) * 0.012;
    }
    // The jaw works open and shut while shouting.
    const isTalking = !isShouting && elapsed < person.talkUntil;
    const talk = isTalking ? 0.07 * Math.abs(Math.sin(elapsed * 11) * Math.sin(elapsed * 3.7 + 1)) : 0;
    const jawGoal = goal.jaw + talk + (isShouting ? 0.24 * Math.abs(Math.sin(elapsed * 9)) : 0);
    rig.jawNow += (jawGoal - rig.jawNow) * Math.min(1, dt * 14);
    if (rig.jaw) turnBone(rig.jaw, qTmp.setFromAxisAngle(AXIS_X, rig.jawNow));
    rig.blinkAt -= dt;
    const isBlinking = !isCalm && rig.blinkAt < 0.12;
    if (rig.blinkAt < 0) rig.blinkAt = 2.5 + Math.random() * 3;
    for (const [name, rest] of Object.entries(rig.face)) {
      const { base, side } = rest;
      const want = goal[base] || [0, 0, 0];
      const now = rig.faceNow[name] || (rig.faceNow[name] = new T.Vector3());
      // x offsets point away from the face's centre line on each side.
      vTmp.set(want[0] * side, want[1], want[2]);
      if (isBlinking && base === 'orbicularis03') vTmp.y -= 0.007;
      now.lerp(vTmp, isBlinking ? 1 : ease);
      rest.bone.position.copy(now).applyMatrix3(rest.toLocal).add(rest.p);
    }
    if (rig.skin) {
      rig.flushNow += ((person.mood === 'angry' ? 1 : 0) - rig.flushNow) * ease;
      rig.skin.emissive.setRGB(0.32 * rig.flushNow, 0.01 * rig.flushNow, 0.01 * rig.flushNow);
    }
  }

  function walk(person, toX, dur, done) {
    const fromX = person.root.position.x;
    const dir = Math.sign(toX - fromX);
    const isArriving = Math.abs(toX - SPOT_X) < 0.01;
    let steps = 0;
    tween(person, dur, (k) => {
      if (Math.floor(k * 6) > steps) {
        steps = Math.floor(k * 6);
        sound('step');
      }
      person.root.position.x = fromX + (toX - fromX) * easeInOut(k);
      person.body.position.y = Math.abs(Math.sin(k * Math.PI * 6)) * 0.025;
      if (person.legs) {
        const swing = Math.sin(k * Math.PI * 6) * 0.38 * Math.sin(k * Math.PI);
        person.legs[0].rotation.x = swing;
        person.legs[1].rotation.x = -swing;
        if (!tweens.some((tw) => tw.key === 'act')) {
          person.arms[0].rotation.x = -swing * 0.6;
          person.arms[1].rotation.x = swing * 0.6;
        }
      }
      const facing = isArriving ? 1 - smooth(0.7, 1, k) : smooth(0, 0.2, k);
      person.root.rotation.y = dir * 1.25 * facing;
    }, () => {
      person.body.position.y = 0;
      if (done) done();
    });
  }

  function removePerson(person) {
    scene.remove(person.root);
    for (const drop of person.drips || []) scene.remove(drop);
    // Model clones share geometry with the cached glTF: only dispose primitives.
    if (!person.rig) person.root.traverse((obj) => { if (obj.geometry) obj.geometry.dispose(); });
  }

  // ---- MIRA's terminal ---------------------------------------------------
  function drawScreen(g, w, h, state = 'idle', t = 0) {
    const s = SCREEN[state];
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#071019');
    bg.addColorStop(1, '#03060a');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.font = `600 13px ${MONO}`;
    g.fillStyle = '#4c6072';
    g.textAlign = 'left';
    g.fillText('MIRA · TRỢ LÝ CÔNG DÂN', 18, 26);
    g.textAlign = 'right';
    g.fillText('QUẦY 07', w - 18, 26);
    const cx = w / 2;
    const cy = 98;
    g.shadowColor = s.color;
    g.shadowBlur = 18;
    g.strokeStyle = s.color;
    g.fillStyle = s.color;
    g.lineWidth = 5;
    g.lineCap = 'round';
    if (state === 'talk') {
      for (let i = 0; i < 15; i++) {
        const bar = 6 + Math.abs(Math.sin(t * 8 + i * 0.75)) * 40 * (0.5 + 0.5 * Math.sin(i * 0.4 + 1));
        g.fillRect(cx - 84 + i * 12, cy - bar / 2, 5, bar);
      }
    } else {
      g.globalAlpha = state === 'idle' ? 0.55 + 0.45 * Math.abs(Math.sin(t * 1.2)) : 1;
      g.beginPath();
      g.arc(cx, cy, 34, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
      g.beginPath();
      if (state === 'ok') {
        g.moveTo(cx - 15, cy + 1); g.lineTo(cx - 3, cy + 13); g.lineTo(cx + 17, cy - 11);
      } else if (state === 'error') {
        g.moveTo(cx, cy - 16); g.lineTo(cx, cy + 4); g.moveTo(cx, cy + 14); g.lineTo(cx, cy + 15);
      } else if (state === 'blocked') {
        g.moveTo(cx - 12, cy - 12); g.lineTo(cx + 12, cy + 12); g.moveTo(cx + 12, cy - 12); g.lineTo(cx - 12, cy + 12);
      } else {
        g.arc(cx, cy, 5, 0, Math.PI * 2);
      }
      g.stroke();
    }
    g.shadowBlur = 0;
    g.font = `600 15px ${MONO}`;
    g.textAlign = 'center';
    g.fillText(s.text, cx, 176);
  }

  function buildMira() {
    const root = group([-1.52, 0.8, 0.36]);
    root.rotation.y = 0.42;
    root.scale.setScalar(0.74);
    const dark = std('#15171b', 0.35, 0.6);
    mesh(box(0.28, 0.02, 0.2), dark, { at: [0, 0.01, 0], parent: root, cast: true });
    mesh(box(0.045, 0.5, 0.04), dark, { at: [0, 0.26, -0.05], parent: root, cast: true });
    const head = group([0, 0.62, 0], root);
    mesh(box(0.68, 0.44, 0.045), std('#0d0f12', 0.25, 0.5), { parent: head, cast: true });
    const face = canvasTexture(320, 200, drawScreen);
    const screen = mesh(new T.PlaneGeometry(0.64, 0.4), new T.MeshBasicMaterial({ map: face.texture, toneMapped: false }), { at: [0, 0, 0.0235], parent: head });
    screen.receiveShadow = false;
    const light = new T.PointLight(0x3fd8ff, 0.8, 2.4, 2);
    light.position.set(0, 0, 0.35);
    head.add(light);
    return { face, light };
  }

  function updateScreen(t) {
    const isTalking = screenState === 'idle' && t >= talkFrom && t < talkUntil;
    const state = isTalking ? 'talk' : screenState;
    const tick = isCalm ? 0 : Math.floor(t * (state === 'talk' ? 18 : 8));
    const key = `${state}|${tick}`;
    if (key === screenKey) return;
    screenKey = key;
    mira.face.redraw(state, t);
    mira.light.color.set(SCREEN[state].color);
  }

  // ---- Anger -------------------------------------------------------------
  function drawCracks(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(225, 238, 250, 0.55)';
    g.lineCap = 'round';
    for (const crack of crackList) {
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(crack.u, crack.v, 5, 0, Math.PI * 2);
      g.stroke();
      for (const ray of crack.rays) {
        g.lineWidth = 0.9;
        g.beginPath();
        g.moveTo(crack.u, crack.v);
        let x = crack.u;
        let y = crack.v;
        for (const [angle, len] of ray) {
          x += Math.cos(angle) * len;
          y += Math.sin(angle) * len;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    }
  }

  // Crack canvas covers the glass (WIN), 640 × 370 px.
  function addCrack(x, y) {
    const rays = Array.from({ length: 6 + Math.floor(Math.random() * 4) }, (_, i) => {
      let angle = (i / 7) * Math.PI * 2 + Math.random() * 0.6;
      return Array.from({ length: 3 }, () => {
        angle += (Math.random() - 0.5) * 0.7;
        return [angle, 9 + Math.random() * 20];
      });
    });
    const u = ((x + WIN.half) / (WIN.half * 2)) * 640;
    const v = (1 - (y - WIN.bottom) / (WIN.top - WIN.bottom)) * 370;
    crackList.push({ u, v, rays });
    cracks.redraw();
  }

  function clearDebris() {
    crackList.length = 0;
    if (cracks) cracks.redraw();
    for (const ball of debris.splice(0)) scene.remove(ball);
  }

  // Each act animates a person and returns how long it runs, in seconds.
  const ACTS = {
    // Pound on the glass with both fists; every blow cracks it.
    bang(person) {
      tween('step', 0.3, (k) => { person.root.position.z = SPOT_Z - 0.1 * easeInOut(k); });
      let hits = 0;
      tween('act', 2.1, (k) => {
        const phase = k * 5;
        const n = Math.floor(phase);
        const f = phase - n;
        const side = n % 2;
        const top = reach(person);
        person.arms[side].rotation.x = -top * (0.55 + 0.45 * Math.sin(f * Math.PI));
        person.arms[1 - side].rotation.x = -top * 0.55;
        if (f > 0.5 && n >= hits && n < 5) {
          hits = n + 1;
          shakeLeft = 0.18;
          sound('knock');
          sound('crack', 0.02);
          const fist = person.hands[side].getWorldPosition(new T.Vector3());
          addCrack(fist.x + (Math.random() - 0.5) * 0.06, fist.y + 0.05 + Math.random() * 0.08);
        }
      }, () => { for (const arm of person.arms) arm.rotation.x = 0; }, 0.25);
      return 2.4;
    },
    // Crumple the form and throw it at the window.
    throw(person) {
      const arm = person.arms[1];
      tween('act', 0.7, (k) => {
        arm.rotation.x = k < 0.55 ? 0.9 * Math.sin((k / 0.55) * Math.PI / 2) : 0.9 - (0.9 + reach(person)) * smooth(0.55, 1, k);
      }, () => {
        sound('whoosh');
        const ball = mesh(new T.IcosahedronGeometry(0.045, 1), std('#ece8dc', 0.95), { cast: true });
        const from = new T.Vector3();
        person.hands[1].getWorldPosition(from);
        const hit = new T.Vector3(from.x * 0.6, 1.5, -0.11);
        const rest = new T.Vector3(hit.x + 0.05, WIN.bottom + 0.04, -0.3);
        debris.push(ball);
        tween('ball', 0.25, (k) => {
          ball.position.lerpVectors(from, hit, k);
          ball.position.y += Math.sin(k * Math.PI) * 0.08;
        }, () => {
          shakeLeft = 0.12;
          sound('paper');
          tween('ballFall', 0.4, (k) => { ball.position.lerpVectors(hit, rest, k * k); ball.rotation.x = k * 4; });
        });
        const top = reach(person);
        tween('armBack', 0.4, (k) => { arm.rotation.x = -top * (1 - k); }, null, 0.3);
      });
      return 1.6;
    },
    // Hold a phone up to the glass and record ("lên mạng ngay").
    film(person) {
      const arm = person.arms[1];
      const phone = group();
      mesh(box(0.065, 0.12, 0.01), std('#141518', 0.3, 0.6), { parent: phone });
      const rec = glow(0xff2a2a, 0.06, [0.02, 0.045, 0.012], phone, 0);
      const flash = glow(0xffffff, 0.16, [-0.02, 0.045, 0.012], phone, 0);
      tween('act', 2.6, (k) => {
        person.hands[1].getWorldPosition(phone.position);
        phone.position.y += 0.06;
        phone.position.z += 0.03;
        phone.lookAt(camera.position);
        arm.rotation.x = -Math.min(1.35, reach(person)) * smooth(0, 0.15, k);
        person.head.rotation.x = -0.08 * smooth(0, 0.15, k);
        rec.material.opacity = Math.sin(k * 40) > 0 ? 0.95 : 0.2;
        flash.material.opacity = Math.abs(k - 0.4) < 0.02 || Math.abs(k - 0.7) < 0.02 ? 1 : 0;
        if (flash.material.opacity && !flash.clicked) sound('shutter');
        flash.clicked = flash.material.opacity > 0;
      }, () => {
        scene.remove(phone);
        const held = arm.rotation.x;
        tween('armBack', 0.3, (k) => { arm.rotation.x = held * (1 - k); });
      });
      return 2.9;
    },
    // Slam both hands down on the counter, twice.
    slam(person) {
      let hits = 0;
      tween('act', 1.8, (k) => {
        const phase = k * 2;
        const n = Math.floor(phase);
        const f = phase - n;
        // Up and back, then down hard onto the ledge.
        const angle = f < 0.6 ? -0.4 - 0.75 * Math.sin((f / 0.6) * Math.PI / 2) : -1.15 + 0.5 * smooth(0.6, 0.75, f);
        for (const arm of person.arms) arm.rotation.x = angle;
        if (f > 0.72 && n >= hits && n < 2) {
          hits = n + 1;
          shakeLeft = 0.28;
          sound('slam');
          if (trayPaper && trayPaper.visible) tween('trayHop', 0.25, (kk) => { trayPaper.position.y = -0.01 + Math.sin(kk * Math.PI) * 0.02; });
        }
      }, () => { for (const arm of person.arms) arm.rotation.x = 0; });
      return 1.9;
    },
    // Jab a finger at the clerk, shaking the head.
    point(person) {
      const arm = person.arms[1];
      tween('act', 1.9, (k) => {
        const top = Math.min(1.3, reach(person));
        arm.rotation.x = -top * (0.88 * smooth(0, 0.12, k) + 0.12 * Math.max(0, Math.sin(k * Math.PI * 7)));
        person.body.rotation.x = 0.07 * smooth(0, 0.12, k);
        person.head.rotation.y = Math.sin(k * Math.PI * 6) * 0.22;
      }, () => {
        arm.rotation.x = 0;
        person.body.rotation.x = 0;
        person.head.rotation.y = 0;
      });
      return 2.0;
    },
  };

  // How far the arm can swing forward (radians) before the hand meets the glass.
  function reach(person) {
    const shoulderZ = person.root.position.z + 0.02;
    const room = (WIN.glassZ - 0.03 - shoulderZ) / (person.armLen || 0.5);
    return Math.asin(Math.min(1, Math.max(0.2, room)));
  }

  function rage(person, acts) {
    setMood(person, 'angry');
    person.shoutUntil = elapsed + 2.8;
    focusGoal = 1;
    beaconColor = 0xff3344;
    beaconUntil = elapsed + 3.5;
    return ACTS[acts[Math.floor(Math.random() * acts.length)]](person);
  }

  // ---- Booth -------------------------------------------------------------
  function buildBooth() {
    const wall = std('#2a2f37', 0.62, 0.35);
    const seam = std('#1d2127', 0.7, 0.3);
    const steel = std('#8b94a1', 0.28, 0.9);
    // Window wall around the opening WIN.
    const side = 4.5 - WIN.half;
    const midY = (WIN.top + WIN.bottom) / 2;
    const openH = WIN.top - WIN.bottom;
    for (const [w, h, x, y] of [
      [9, WIN.bottom, 0, WIN.bottom / 2],
      [9, 3.3 - WIN.top, 0, (3.3 + WIN.top) / 2],
      [side, openH, -(WIN.half + side / 2), midY],
      [side, openH, WIN.half + side / 2, midY],
    ]) {
      mesh(box(w, h, 0.12), wall, { at: [x, y, -0.06] });
    }
    for (const x of [-3.6, -2.75, 2.75, 3.6]) mesh(box(0.02, 3.3, 0.02), seam, { at: [x, 1.65, 0.005] });
    mesh(box(9, 0.02, 0.02), seam, { at: [0, 2.6, 0.005] });
    for (const s of [-1, 1]) mesh(box(0.12, 3.3, 3), std('#23272e', 0.65, 0.3), { at: [s * 3.4, 1.65, 1.2] });

    // Window frame, glass and counter.
    const glassW = WIN.half * 2;
    mesh(box(glassW + 0.14, 0.07, 0.16), steel, { at: [0, WIN.top + 0.035, -0.04] });
    for (const s of [-1, 1]) mesh(box(0.07, openH + 0.07, 0.16), steel, { at: [s * (WIN.half + 0.035), midY, -0.04] });
    mesh(box(0.035, openH, 0.05), steel, { at: [0.62, midY, -0.06] });   // mullion
    // Brushed sill: rough enough not to mirror the neon as a coloured strip.
    const sill = std('#6f7681', 0.62, 0.55, { envMapIntensity: 0.35 });
    mesh(box(glassW + 0.2, 0.045, 0.5), sill, { at: [0, WIN.bottom, -0.04] });
    mesh(new T.PlaneGeometry(glassW, openH), new T.MeshStandardMaterial({
      color: 0xa9c4e0, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0.9, envMapIntensity: 1.6,
    }), { at: [0, midY, WIN.glassZ] });
    const rainOnGlass = canvasTexture(768, 420, drawRainDrops);
    mesh(new T.PlaneGeometry(glassW, openH), new T.MeshBasicMaterial({
      map: rainOnGlass.texture, transparent: true, depthWrite: false, opacity: 0.55,
    }), { at: [0, midY, WIN.glassZ - 0.004] }).receiveShadow = false;
    cracks = canvasTexture(640, 370, drawCracks);
    mesh(new T.PlaneGeometry(glassW, openH), new T.MeshBasicMaterial({
      map: cracks.texture, transparent: true, depthWrite: false, toneMapped: false,
    }), { at: [0, midY, WIN.glassZ + 0.005] }).receiveShadow = false;
    buildGrille(steel);
    buildTray(steel);
    buildLedge(steel);

    // Desk.
    mesh(box(6.6, 0.05, 2.2), std('#3a281c', 0.48, 0.05), { at: [0, 0.775, 1.1] });
    mesh(box(6.6, 0.02, 0.05), std('#22180f', 0.5), { at: [0, 0.8, 0.02] });

    // Lightbox above the window.
    plate(2.2, 0.2, 900, (g, w, h) => {
      g.fillStyle = '#0d1014';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffb547';
      g.shadowColor = '#ffb547';
      g.shadowBlur = 16;
      g.font = `700 46px ${SANS}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const label = 'QUẦY 07 · HỎI ĐÁP CÔNG DÂN 24H';
      const size = Math.min(46, Math.floor((46 * (w - 60)) / g.measureText(label).width));
      g.font = `700 ${size}px ${SANS}`;
      g.fillText(label, w / 2, h / 2 + 2);
    }, [0, 2.29, 0.01], { isLit: true });
    glow(0xffb547, 1.8, [0, 2.29, 0.08], null, 0.16);

    // Procedure memo (left) and MIRA poster (right).
    plate(0.72, 0.95, 360, (g, w, h) => {
      g.fillStyle = '#e8e4d8';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#b4232c';
      g.fillRect(0, 0, w, 54);
      g.fillStyle = '#fff';
      g.font = `700 22px ${SANS}`;
      g.fillText('QUY TRÌNH KIỂM DUYỆT', 22, 35);
      g.fillStyle = '#23252a';
      g.font = `500 19px ${SANS}`;
      ['1. Đọc kỹ từng câu', '2. Đối chiếu kho dữ liệu', '3. Gắn cờ câu sai', '4. Ký duyệt rồi mới gửi'].forEach((line, i) => g.fillText(line, 22, 104 + i * 42));
      g.font = `500 15px ${SANS}`;
      g.fillStyle = '#6b6d72';
      g.fillText('Luật Thông tin 2040 · Điều 12', 22, h - 28);
    }, [-1.95, 1.52, 0.005]);
    plate(0.62, 0.86, 320, (g, w, h) => {
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#0e2236');
      bg.addColorStop(1, '#06101a');
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#3fd8ff';
      g.lineWidth = 8;
      g.beginPath();
      g.arc(w / 2, 140, 62, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#e6f6ff';
      g.textAlign = 'center';
      g.font = `700 54px ${SANS}`;
      g.fillText('MIRA', w / 2, 278);
      g.font = `500 22px ${SANS}`;
      g.fillText('Luôn đúng.*', w / 2, 318);
      g.fillText('Luôn sẵn sàng.', w / 2, 350);
      g.save();
      g.translate(w / 2 + 40, 404);
      g.rotate(-0.18);
      g.fillStyle = '#ff5263';
      g.font = `italic 600 22px ${SANS}`;
      g.fillText('*gần như', 0, 0);
      g.restore();
    }, [1.92, 1.52, 0.005]);

    // Digital wall clock.
    clock = plate(0.42, 0.14, 300, (g, w, h, label = '22:00') => {
      g.fillStyle = '#08090b';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ff3b3b';
      g.shadowColor = '#ff3b3b';
      g.shadowBlur = 14;
      g.font = `600 64px ${MONO}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, w / 2, h / 2 + 3);
    }, [-1.95, 2.17, 0.01], { isLit: true });

    // Status beacon (above the window, right).
    const beaconRoot = group([1.5, 2.26, 0.07]);
    mesh(cyl(0.06, 0.07, 0.04), std('#1c1f24', 0.4, 0.6), { parent: beaconRoot });
    const domeMat = new T.MeshStandardMaterial({ color: 0x40181a, emissive: 0x000000, roughness: 0.25, transparent: true, opacity: 0.92 });
    mesh(shell(0.055, 0.5), domeMat, { at: [0, 0.02, 0], parent: beaconRoot });
    const beaconLight = new T.PointLight(0xff3344, 0, 3, 2);
    beaconLight.position.set(0, 0.05, 0.2);
    beaconRoot.add(beaconLight);
    const beaconGlow = glow(0xff3344, 0.5, [0, 0.05, 0.02], beaconRoot, 0);
    beacon = { domeMat, light: beaconLight, glow: beaconGlow };

    // Desk props.
    mira = buildMira();
    buildLamp();
    printer = buildPrinter();
    const paper = std('#e9e6dc', 0.95);
    [0, 1, 2].forEach((i) => mesh(box(0.3, 0.004, 0.42), paper, {
      at: [-0.42 + i * 0.012, 0.803 + i * 0.005, 0.95 - i * 0.01], rot: [0, 0.12 - i * 0.1, 0], cast: true,
    }));
    const mug = group([0.35, 0.8, 1.05]);
    const ceramic = std('#e5e1d8', 0.3);
    mesh(cyl(0.045, 0.04, 0.1), ceramic, { at: [0, 0.05, 0], parent: mug, cast: true });
    mesh(new T.TorusGeometry(0.028, 0.008, 10, 20), ceramic, { at: [0.05, 0.05, 0], parent: mug, cast: true });
    mesh(cyl(0.04, 0.04, 0.004), std('#2a1609', 0.15), { at: [0, 0.092, 0], parent: mug });
    const stamp = group([0.02, 0.8, 0.72]);
    mesh(box(0.08, 0.025, 0.05), std('#7a1e22', 0.6), { at: [0, 0.0125, 0], parent: stamp, cast: true });
    mesh(cyl(0.012, 0.016, 0.07), std('#2a1d16', 0.5), { at: [0, 0.06, 0], parent: stamp, cast: true });
    mesh(sph(0.022), std('#2a1d16', 0.5), { at: [0, 0.1, 0], parent: stamp, cast: true });

    // Room lights.
    scene.add(new T.HemisphereLight(0x52607d, 0x08090c, 0.45));
    const ceiling = new T.PointLight(0xfff0dc, 0.75, 6, 2);
    ceiling.position.set(0, 2.6, 1.0);
    scene.add(ceiling);
    const faceLight = new T.PointLight(0xffe4c8, 1.5, 3.2, 2);
    faceLight.position.set(0.25, 2.0, 0.25);
    scene.add(faceLight);
    // Rim lights from the street behind the customer's spot (no shadows).
    for (const [color, x, power] of [[0x3fd8ff, 1.5, 5], [0xff5a9a, -1.4, 3.6]]) {
      const rim = new T.SpotLight(color, power, 4.5, 0.42, 0.9, 1.5);
      rim.position.set(SPOT_X + x, 2.35, SPOT_Z - 2.1);
      rim.target.position.set(SPOT_X, 1.45, SPOT_Z);
      scene.add(rim, rim.target);
    }
  }

  function drawRainDrops(g, w, h) {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 0.6 + Math.random() ** 3 * 2.6;
      const drop = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      drop.addColorStop(0, 'rgba(255,255,255,0.5)');
      drop.addColorStop(0.6, 'rgba(190,215,240,0.16)');
      drop.addColorStop(1, 'rgba(160,190,220,0)');
      g.fillStyle = drop;
      g.beginPath();
      g.ellipse(x, y, r, r * 1.15, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Round, perforated speaking grille set into the glass at mouth height.
  function buildGrille(steel) {
    const holes = canvasTexture(128, 128, (g, w) => {
      g.clearRect(0, 0, w, w);
      g.fillStyle = 'rgba(40,44,52,0.95)';
      for (let y = 10; y < w; y += 12) {
        for (let x = 10; x < w; x += 12) {
          if ((x - w / 2) ** 2 + (y - w / 2) ** 2 < (w / 2 - 8) ** 2) {
            g.beginPath();
            g.arc(x, y, 2.6, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    });
    const at = [-0.32, 1.52, WIN.glassZ + 0.006];
    mesh(new T.CircleGeometry(0.1, 40), new T.MeshStandardMaterial({
      map: holes.texture, transparent: true, metalness: 0.8, roughness: 0.4, color: 0x9aa2ad,
    }), { at });
    mesh(new T.TorusGeometry(0.1, 0.008, 10, 48), steel, { at });
  }

  // The customer's side of the counter: a deep worn ledge with a raised lip,
  // so the customer reads as standing behind a counter, not cut off by it.
  function buildLedge(steel) {
    const glassW = WIN.half * 2;
    // Worn laminate: wood grain, scratches, a lighter band where elbows rest.
    const grain = canvasTexture(512, 128, (g, w, h) => {
      g.fillStyle = '#3d3229';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        g.strokeStyle = `rgba(${20 + Math.random() * 30},${14 + Math.random() * 18},10,${0.15 + Math.random() * 0.25})`;
        g.lineWidth = 0.6 + Math.random() * 1.6;
        const y = Math.random() * h;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 8, w * 0.7, y + (Math.random() - 0.5) * 8, w, y + (Math.random() - 0.5) * 6);
        g.stroke();
      }
      g.strokeStyle = 'rgba(210,190,160,0.12)';
      for (let i = 0; i < 40; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        g.lineWidth = 0.5;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 10);
        g.stroke();
      }
      const wear = g.createLinearGradient(0, h * 0.55, 0, h);
      wear.addColorStop(0, 'rgba(255,230,200,0)');
      wear.addColorStop(1, 'rgba(255,230,200,0.08)');
      g.fillStyle = wear;
      g.fillRect(0, 0, w, h);
    });
    const top = new T.MeshStandardMaterial({ map: grain.texture, roughness: 0.62, metalness: 0.05 });
    const lipZ = WIN.glassZ - LEDGE_DEPTH;
    mesh(box(glassW + 0.2, 0.05, LEDGE_DEPTH), top, { at: [0, WIN.bottom - 0.005, WIN.glassZ - LEDGE_DEPTH / 2] });
    mesh(box(glassW + 0.2, 0.03, 0.03), std('#5d636c', 0.6, 0.5, { envMapIntensity: 0.3 }), { at: [0, WIN.bottom + 0.03, lipZ + 0.015] });
    // Shadowed front of the kiosk below the counter.
    mesh(box(glassW + 0.2, WIN.bottom - 0.03, 0.04), std('#16181d', 0.75, 0.25), {
      at: [0, (WIN.bottom - 0.03) / 2, lipZ - 0.01],
    });
  }

  // Recessed steel tray under the glass; papers slide through it.
  function buildTray(steel) {
    const tray = group([0, WIN.bottom - 0.005, -0.04]);
    mesh(box(0.56, 0.008, 0.62), std('#0c0d10', 0.35, 0.7), { at: [0, -0.02, 0], parent: tray });
    for (const s of [-1, 1]) mesh(box(0.012, 0.03, 0.62), steel, { at: [s * 0.28, -0.005, 0], parent: tray });
    const paperTex = canvasTexture(128, 180, (g, w, h) => {
      g.fillStyle = '#efece3';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#b4232c';
      g.fillRect(0, 0, w, 16);
      g.fillStyle = '#9b988f';
      for (let i = 0; i < 10; i++) g.fillRect(12, 30 + i * 14, w - 24 - (i % 3) * 18, 3);
    });
    trayPaper = mesh(new T.PlaneGeometry(0.21, 0.29), new T.MeshStandardMaterial({ map: paperTex.texture, roughness: 0.9 }), {
      at: [0, -0.01, -0.5], rot: [-Math.PI / 2, 0, 0], parent: tray,
    });
    trayPaper.visible = false;
  }

  // 'in': the customer's papers come to the clerk; 'out': the signed form goes back.
  function slidePaper(direction) {
    if (!trayPaper) return;
    const out = WIN.glassZ - LEDGE_DEPTH * 0.6;
    const from = direction === 'in' ? out : 0.22;
    const to = direction === 'in' ? 0.22 : out;
    trayPaper.visible = true;
    sound('slide');
    tween('tray', 0.7, (k) => { trayPaper.position.z = from + (to - from) * easeInOut(k); },
      () => { trayPaper.visible = direction === 'in'; });
  }

  function buildLamp() {
    const root = group([1.62, 0.8, 0.5]);
    root.rotation.y = -0.5;
    const metal = std('#16181c', 0.35, 0.8);
    mesh(cyl(0.08, 0.09, 0.025), metal, { at: [0, 0.0125, 0], parent: root, cast: true });
    mesh(cyl(0.01, 0.01, 0.42), metal, { at: [0.04, 0.22, 0], rot: [0, 0, -0.2], parent: root, cast: true });
    mesh(cyl(0.01, 0.01, 0.34), metal, { at: [-0.06, 0.48, 0], rot: [0, 0, 1.15], parent: root, cast: true });
    mesh(new T.ConeGeometry(0.09, 0.13, 28, 1, true), new T.MeshStandardMaterial({
      color: 0x1d2025, roughness: 0.4, metalness: 0.7, side: T.DoubleSide,
    }), { at: [-0.22, 0.5, 0], rot: [0, 0, 0.55], parent: root, cast: true });
    mesh(sph(0.025), lit('#ffe2b0'), { at: [-0.24, 0.455, 0], parent: root });
    glow(0xffc27a, 0.3, [-0.25, 0.44, 0], root, 0.35);   // bloom adds the rest
    const spot = new T.SpotLight(0xffc27a, 2.4, 5, 0.8, 0.6, 1.6);
    spot.position.set(1.44, 1.25, 0.65);
    spot.target.position.set(0.2, 0.8, 0.45);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0015;
    spot.shadow.radius = 4;
    scene.add(spot, spot.target);
  }

  function buildPrinter() {
    const root = group([1.0, 0.8, 0.42]);
    root.rotation.y = -0.35;
    mesh(box(0.3, 0.11, 0.24), std('#2a2d33', 0.45, 0.4), { at: [0, 0.055, 0], parent: root, cast: true });
    mesh(box(0.22, 0.01, 0.03), std('#07080a', 0.6), { at: [0, 0.111, 0.06], parent: root });
    mesh(sph(0.008), lit('#4ade80'), { at: [0.12, 0.08, 0.121], parent: root });
    const slipTex = canvasTexture(160, 240, (g, w, h) => {
      g.fillStyle = '#f2f0e8';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#b4232c';
      g.fillRect(0, 0, w, 40);
      g.fillStyle = '#fff';
      g.font = `700 20px ${SANS}`;
      g.textAlign = 'center';
      g.fillText('BIÊN BẢN', w / 2, 27);
      g.fillStyle = '#9a9890';
      for (let i = 0; i < 8; i++) g.fillRect(16, 62 + i * 20, w - 32 - (i % 3) * 24, 5);
    });
    texts.push(slipTex.redraw);
    const geo = box(0.17, 0.26, 0.003);
    geo.translate(0, 0.13, 0);
    const slip = mesh(geo, new T.MeshStandardMaterial({ map: slipTex.texture, roughness: 0.9 }), {
      at: [0, 0.112, 0.06], rot: [-0.35, 0, 0], parent: root, cast: true,
    });
    slip.scale.y = 0.001;
    slip.visible = false;
    return { slip };
  }

  // ---- Street ------------------------------------------------------------
  function buildStreet() {
    mesh(new T.PlaneGeometry(60, 40), std('#0c0f14', 0.16, 0.75), { at: [0, 0, -20.2], rot: [-Math.PI / 2, 0, 0] });
    mesh(box(14, 0.12, 0.6), std('#2b2f36', 0.8), { at: [0, 0.06, -2.4] });

    // Facades are painted out of focus (the camera focuses on the customer):
    // sparse lit windows of varied warmth, blurred, with floor bands.
    const windows = canvasTexture(256, 512, (g, w, h) => {
      g.fillStyle = '#0a0d14';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.025)';
      for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 3);
      g.filter = 'blur(2.2px)';
      const tones = ['#ffcf8a', '#ffd9a6', '#f4b26a', '#cfe6ff', '#a9c8ff', '#ffe8c7'];
      for (let y = 10; y < h; y += 32) {
        for (let x = 10; x < w; x += 38) {
          if (Math.random() < 0.24) {
            g.fillStyle = tones[Math.floor(Math.random() * tones.length)];
            g.globalAlpha = 0.18 + Math.random() * 0.45;
            g.fillRect(x, y, 20 + Math.random() * 6, 14);
          }
        }
      }
      g.filter = 'none';
      g.globalAlpha = 1;
    }).texture;
    windows.wrapS = T.RepeatWrapping;
    windows.wrapT = T.RepeatWrapping;
    for (let i = 0; i < 22; i++) {
      const w = 2 + Math.random() * 3;
      const h = 5 + Math.random() * 16;
      const d = 2 + Math.random() * 2;
      const x = -18 + i * 1.7 + Math.random() * 1.2;
      const z = -8 - Math.random() * 16;
      const map = windows.clone();
      map.needsUpdate = true;
      map.repeat.set(w / 5, h / 10);
      map.offset.set(Math.random(), Math.random());
      // Further buildings are dimmer before fog even starts.
      const shade = 0.95 - Math.min(0.4, (-z - 8) * 0.025);
      mesh(box(w, h, d), new T.MeshBasicMaterial({ map, color: new T.Color(shade, shade * 1.02, shade * 1.1) }), { at: [x, h / 2, z] });
    }

    neon('MIRA · TRỢ LÝ CỦA MỌI CÔNG DÂN', '#3fd8ff', 4.2, 0.62, [2.9, 3.4, -6.4], 0x3fd8ff);
    neon('PHỞ 24H', '#ff4d6d', 1.3, 0.42, [-3.2, 2.4, -5.6], 0xff4d6d);
    neon('NHÀ THUỐC', '#4ade80', 1.5, 0.38, [-5.6, 3.1, -7.4], 0x4ade80);
    neon('KHÁCH SẠN TÂN CẢNG', '#c084fc', 2.8, 0.4, [5.8, 4.6, -8.6], 0xc084fc);

    for (const [x, z] of [[-2.6, -3.2], [3.1, -4.2]]) {
      const metal = std('#22262c', 0.4, 0.7);
      mesh(cyl(0.04, 0.05, 3.4, 12), metal, { at: [x, 1.7, z] });
      mesh(box(0.5, 0.04, 0.06), metal, { at: [x + 0.22, 3.38, z] });
      mesh(box(0.2, 0.05, 0.12), lit('#ffd39a'), { at: [x + 0.42, 3.34, z] });
      glow(0xffb36b, 1.4, [x + 0.42, 3.3, z], null, 0.5);
      const light = new T.PointLight(0xffa860, 1.6, 9, 2);
      light.position.set(x + 0.42, 3.2, z);
      scene.add(light);
      lightCone(0xffb070, [x + 0.42, 3.3, z], 2.9, 1.0);   // stops short of the street: no seam
      streak(0xffa860, x + 0.42, z, 0.7, 2.2, 0.5);
    }
    const magenta = new T.PointLight(0xff3d9a, 0.7, 7, 2);
    magenta.position.set(-2.5, 2.2, -3.5);
    const cyan = new T.PointLight(0x2ad4ff, 0.9, 8, 2);
    cyan.position.set(2.6, 2.8, -4.5);
    scene.add(magenta, cyan);
    buildAtmosphere();
    rain = buildRain();
  }

  function neon(text, color, width, height, at, glowColor) {
    const sign = plate(width, height, Math.round(width * 220), (g, w, h) => {
      g.fillStyle = '#05070a';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = color;
      g.lineWidth = 4;
      g.shadowColor = color;
      g.shadowBlur = 18;
      roundRect(g, 8, 8, w - 16, h - 16, 14);
      g.stroke();
      g.fillStyle = '#ffffff';
      g.font = `700 ${Math.round(h * 0.5)}px ${SANS}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 2);
      g.fillStyle = color;
      g.globalAlpha = 0.6;
      g.fillText(text, w / 2, h / 2 + 2);
      g.globalAlpha = 1;
    }, at, { isLit: true });
    const halo = glow(glowColor, width * 1.4, [at[0], at[1], at[2] + 0.1], null, 0.22);
    // Its smeared reflection on the wet street.
    const wet = streak(glowColor, at[0], at[2], width * 0.75, Math.min(4, -at[2] - 2.6), 0.42);
    const seed = Math.random() * 10;
    idlers.push((t) => {
      const flicker = Math.sin(t * 23 + seed) > 0.97 ? 0.4 : 1;
      sign.mesh.material.color.setScalar(flicker);
      halo.material.opacity = 0.22 * flicker;
      wet.material.opacity = wet.base * flicker * (0.86 + 0.14 * Math.sin(t * 2.3 + seed));
    });
  }

  // A soft vertical smear on the wet asphalt, from (x, z) towards the camera.
  let streakTexture = null;
  function streak(color, x, z, width, length, opacity) {
    if (!streakTexture) {
      streakTexture = canvasTexture(64, 256, (g, w, h) => {
        const img = g.createImageData(w, h);
        for (let y = 0; y < h; y++) {
          // Ripples break the smear into bands; it fades towards the camera.
          const band = 0.55 + 0.45 * Math.random();
          const fade = (1 - y / h) ** 1.3;
          for (let px = 0; px < w; px++) {
            const across = Math.exp(-(((px - w / 2) / (w * 0.2)) ** 2));
            const a = Math.round(255 * fade * band * across);
            img.data.set([255, 255, 255, a], (y * w + px) * 4);
          }
        }
        g.putImageData(img, 0, 0);
      }).texture;
    }
    const material = new T.MeshBasicMaterial({
      map: streakTexture, color, transparent: true, opacity, depthWrite: false, blending: T.AdditiveBlending,
    });
    const m = mesh(new T.PlaneGeometry(width, length), material, { at: [x, 0.013, z + length / 2], rot: [-Math.PI / 2, 0, 0] });
    m.receiveShadow = false;
    m.base = opacity;
    return m;
  }

  // Light falling through the rain under a street lamp: an open cone, bright
  // at the lamp and where it faces the camera edge-on, fading to the ground.
  function lightCone(color, at, height, radius) {
    const material = new T.ShaderMaterial({
      uniforms: { color: { value: new T.Color(color) }, strength: { value: 0.16 } },
      vertexShader: `varying float vH; varying float vFace;
        void main() {
          vH = uv.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 color; uniform float strength; varying float vH; varying float vFace;
        void main() { gl_FragColor = vec4(color * strength * pow(clamp(vH, 0.0, 1.0), 1.7) * vFace * vFace, 1.0); }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    });
    const cone = mesh(new T.ConeGeometry(radius, height, 32, 1, true), material, { at: [at[0], at[1] - height / 2, at[2]] });
    cone.receiveShadow = false;
    return cone;
  }

  // Haze between the street layers, steam from the phở shop, rain rings in puddles.
  function buildAtmosphere() {
    const mist = canvasTexture(512, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        const x = Math.random() * w;
        const y = h * (0.3 + Math.random() * 0.5);
        const r = 20 + Math.random() * 60;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(255,255,255,0.22)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        // Drawn three times so the texture tiles across its seam.
        for (const dx of [-w, 0, w]) g.fillRect(x - r + dx, y - r, r * 2, r * 2);
      }
    }).texture;
    mist.wrapS = T.RepeatWrapping;
    for (const [z, y, w, h, opacity, speed] of [[-4.2, 0.6, 14, 1.4, 0.06, 0.006], [-7.5, 1.4, 20, 3.2, 0.09, -0.004], [-12, 2.6, 28, 6.5, 0.14, 0.003]]) {
      const map = mist.clone();
      map.needsUpdate = true;
      map.repeat.set(w / 10, 1);
      const m = mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map, color: 0x6f80a3, transparent: true, opacity, depthWrite: false }), { at: [0, y, z] });
      m.receiveShadow = false;
      idlers.push((time, dt) => { map.offset.x += speed * dt * 10; });
    }

    const steam = Array.from({ length: 12 }, (_, i) => ({ sprite: glow(0xc8d2e2, 0.4, [-3.2, 1, -5.3], null, 0), phase: i / 12 }));
    idlers.push((time) => {
      for (const s of steam) {
        const age = (time * 0.22 + s.phase) % 1;
        s.sprite.position.set(-3.25 + Math.sin(age * 3 + s.phase * 9) * 0.18 + age * 0.25, 0.95 + age * 1.5, -5.3);
        s.sprite.scale.setScalar(0.35 + age * 1.1);
        s.sprite.material.opacity = Math.sin(age * Math.PI) * 0.1;
      }
    });

    const ring = canvasTexture(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 3;
      g.filter = 'blur(1px)';
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2 - 5, 0, Math.PI * 2);
      g.stroke();
    }).texture;
    const spot = (r) => r.position.set(-4 + Math.random() * 8, 0.015, -2.8 - Math.random() * 6);
    const rings = Array.from({ length: 28 }, () => {
      const r = mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({
        map: ring, color: 0xa9bde0, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending,
      }), { rot: [-Math.PI / 2, 0, 0] });
      r.receiveShadow = false;
      r.phase = Math.random();
      r.last = 1;
      spot(r);
      return r;
    });
    idlers.push((time) => {
      for (const r of rings) {
        const age = (time * 1.4 + r.phase) % 1;
        if (age < r.last) spot(r);
        r.last = age;
        r.scale.setScalar(0.04 + age * 0.32);
        r.material.opacity = (1 - age) * 0.4;
      }
    });
  }

  function buildRain() {
    const count = 700;
    const drops = Array.from({ length: count }, () => ({
      x: -6 + Math.random() * 12, y: Math.random() * 5, z: -9 + Math.random() * 8.6, v: 5 + Math.random() * 2.5,
    }));
    const positions = new Float32Array(count * 6);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(positions, 3));
    const lines = new T.LineSegments(geo, new T.LineBasicMaterial({ color: 0x9fb4d6, transparent: true, opacity: 0.32 }));
    lines.frustumCulled = false;
    scene.add(lines);
    const write = () => {
      drops.forEach((d, i) => {
        positions.set([d.x, d.y, d.z, d.x + 0.015, d.y + 0.16, d.z], i * 6);
      });
      geo.attributes.position.needsUpdate = true;
    };
    write();
    return {
      update(dt) {
        for (const d of drops) {
          d.y -= d.v * dt;
          if (d.y < 0) d.y += 5;
        }
        write();
      },
    };
  }

  // Neon-coloured surroundings for reflections on metal, glass and the wet street.
  function buildEnvironment() {
    const env = new T.Scene();
    env.background = new T.Color(0x05070c);
    const panel = (color, scale, w, h, at) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(scale), side: T.DoubleSide }));
      m.position.set(...at);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(0x3fd8ff, 2, 6, 2, [6, 3, -8]);
    panel(0xff3d9a, 2, 4, 2, [-7, 2, -6]);
    panel(0xffb36b, 3, 3, 3, [0, 8, 2]);
    panel(0xfff0dc, 1.5, 5, 2, [0, 4, 6]);
    const pmrem = new T.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
  }

  // ---- Post-processing ---------------------------------------------------
  // Bloom on the HDR frame (neon, lamps, screens), then one grading pass:
  // slight lens fringing at the edges, ACES tone mapping, a cool-shadow /
  // warm-highlight split, vignette and film grain.
  const GRADE = {
    uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.035 }, vignette: { value: 0.5 }, fringe: { value: 0.0022 } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time, grain, vignette, fringe;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 d = vUv - 0.5;
        float r2 = dot(d, d);
        vec2 off = d * fringe * (1.0 + 6.0 * r2);
        vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
        float luma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor.rgb *= mix(vec3(0.94, 0.99, 1.07), vec3(1.04, 1.0, 0.95), smoothstep(0.15, 0.7, luma));
        gl_FragColor.rgb *= 1.0 - vignette * smoothstep(0.08, 0.55, r2);
        gl_FragColor.rgb += (hash(vUv * 1024.0 + fract(time) * 61.0) - 0.5) * grain;
      }`,
  };

  function buildPost() {
    const { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass } = ADDONS;
    if (!EffectComposer || !RenderPass || !UnrealBloomPass || !ShaderPass) return;
    const target = new T.WebGLRenderTarget(1, 1, {
      type: T.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0,
    });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new T.Vector2(256, 256), 0.6, 0.4, 0.92);
    composer.addPass(bloomPass);
    gradePass = new ShaderPass(GRADE);
    composer.addPass(gradePass);
  }

  // Slow machine: drop bloom and render at 1x after a few seconds of measuring.
  function watchSpeed(dt) {
    if (!composer || perf.n >= 300) return;
    perf.n += 1;
    if (perf.n > 60) perf.sum += dt;
    if (perf.n === 300 && perf.sum / 240 > 1 / 38) {
      bloomPass.enabled = false;
      renderer.setPixelRatio(1);
      composer.setPixelRatio(1);
      resize();
    }
  }

  // ---- Frame loop --------------------------------------------------------
  function idle(t, dt) {
    if (!isCalm) {
      for (const fn of idlers) fn(t, dt);
      rain.update(dt);
    }
    for (const person of [customer, ...leaving]) if (person && person.rig) applyRig(person, dt);
    if (customer) {
      const isBlink = !isCalm && t % 4.1 < 0.11;
      for (const eye of customer.eyes) eye.scale.y = customer.eyeOpen * (isBlink ? 0.1 : 1);
      if (!isCalm) {
        if (!customer.rig) customer.body.scale.y = 1 + Math.sin(t * 1.8) * 0.006;
        if (!tweens.some((tw) => tw.key === 'head' || tw.key === 'act')) {
          const towardClerk = Math.atan2(camera.position.x - customer.root.position.x, camera.position.z - customer.root.position.z) * 0.5;
          customer.head.rotation.y = towardClerk + Math.sin(t * 0.35) * 0.04;
        }
      }
    }
    const isBeaconOn = t < beaconUntil && (isCalm || Math.sin(t * 16) > 0);
    beacon.domeMat.emissive.set(isBeaconOn ? beaconColor : 0x000000);
    beacon.domeMat.emissiveIntensity = isBeaconOn ? 2.2 : 0;
    beacon.light.color.set(beaconColor);
    beacon.light.intensity = isBeaconOn ? 2 : 0;
    beacon.glow.material.color.set(beaconColor);
    beacon.glow.material.opacity = isBeaconOn ? 0.85 : 0;
    updateScreen(t);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (frame.last || now)) / 1000);
    frame.last = now;
    if (document.hidden || !view.offsetParent) return;
    elapsed += dt;
    runTweens(dt);
    idle(elapsed, dt);
    placeCamera(dt);
    if (composer) {
      if (!isCalm) gradePass.uniforms.time.value = elapsed;
      composer.render(dt);
      watchSpeed(dt);
    } else {
      renderer.render(scene, camera);
    }
    if (onAnchor) onAnchor(customerAnchor());
  }

  // Booth-wide shot, or pushed in on the customer's face when they lose it.
  function placeCamera(dt) {
    focus += (focusGoal - focus) * (isCalm ? 1 : Math.min(1, dt * 2.6));
    const f = easeInOut(Math.min(1, Math.max(0, focus)));
    camNow.set(camHome.x, camHome.y, camHome.z);
    lookNow.copy(lookBase);
    let fov = baseFov;
    if (customer && f > 0.001) {
      (customer.anchor || customer.head).getWorldPosition(headPos);
      // Eye level: from above, the brows hide the eyes.
      camNow.lerp(vTmp.set(headPos.x * 0.6, headPos.y + 0.07, headPos.z + 1.5), f);
      lookNow.lerp(vTmp.set(headPos.x, headPos.y + 0.0, headPos.z), f);
      fov = baseFov + (30 - baseFov) * f;
    }
    if (shakeLeft > 0 && !isCalm) {
      shakeLeft -= dt;
      const a = Math.max(0, shakeLeft) * 0.05;
      camNow.x += (Math.random() - 0.5) * a;
      camNow.y += (Math.random() - 0.5) * a;
    }
    if (!closeLight) {
      closeLight = new T.PointLight(0xffe2c4, 0, 2.2, 2);
      scene.add(closeLight);
    }
    closeLight.intensity = 1.3 * f;
    closeLight.position.set(camNow.x + 0.35, camNow.y + 0.15, camNow.z - 0.2);
    camera.position.copy(camNow);
    camera.lookAt(lookNow);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function customerAnchor() {
    if (!customer) return null;
    (customer.anchor || customer.head).getWorldPosition(headPos);
    headPos.project(camera);
    return { x: ((headPos.x + 1) / 2) * view.clientWidth, y: ((1 - headPos.y) / 2) * view.clientHeight };
  }

  function resize() {
    const w = view.clientWidth;
    const h = view.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h);
    camera.aspect = w / h;
    const halfWidth = camera.aspect >= 1.8 ? FRAME.wideHalf : FRAME.narrowHalf;
    const halfHeight = Math.max((FRAME.top - FRAME.bottom) / 2, halfWidth / camera.aspect);
    const centre = (FRAME.top + FRAME.bottom) / 2;
    camHome.y = centre + CAM_RISE;
    baseFov = (2 * Math.atan(halfHeight / camHome.z) * 180) / Math.PI;
    camera.fov = baseFov;
    lookBase.set(0, centre - 0.04, 0);
    camera.position.set(camHome.x, camHome.y, camHome.z);
    camera.lookAt(lookBase);
    camera.updateProjectionMatrix();
  }

  let clockLabel = '22:00';
  function setClock(label = clockLabel) {
    clockLabel = label;
    if (clock) clock.redraw(label);
  }

  // ---- Public API --------------------------------------------------------
  function init(viewEl, canvasEl) {
    if (!T) return false;
    try {
      renderer = new T.WebGLRenderer({ canvas: canvasEl, antialias: true });
    } catch (error) {
      return false;
    }
    view = viewEl;
    T.ColorManagement.legacyMode = false;
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    scene = new T.Scene();
    scene.background = new T.Color(0x070a12);
    scene.fog = new T.Fog(0x080b13, 10, 36);
    camera = new T.PerspectiveCamera(40, 2, 0.05, 60);
    glowTexture = makeGlowTexture();

    buildEnvironment();
    buildPost();
    buildStreet();
    buildBooth();
    setClock();

    if (document.fonts) {
      Promise.all([`700 46px ${SANS}`, `500 22px ${SANS}`, `italic 600 22px ${SANS}`, `600 15px ${MONO}`]
        .map((font) => document.fonts.load(font).catch(() => null))).then(() => {
        texts.forEach((redraw) => redraw());
        setClock();
        screenKey = '';
      });
    }
    new ResizeObserver(resize).observe(view);
    resize();
    requestAnimationFrame(frame);
    isReady = true;
    return true;
  }

  // Empty booth, clock back to 22:00 (start of a shift or the title screen).
  function reset() {
    if (!isReady) return;
    if (customer) {
      removePerson(customer);
      customer = null;
    }
    setClock('22:00');
    clearDebris();
    if (trayPaper) trayPaper.visible = false;
    calmDown();
  }

  function enterCustomer(look) {
    if (!isReady) return;
    focusGoal = 0;
    leaveCustomer();
    if (!look) return;   // e.g. the supervisor on the radio: nobody at the window
    customer = buildPerson(look);
    walk(customer, SPOT_X, 1.6);
    talkFrom = elapsed + 1.4;
    talkUntil = elapsed + 3.2;
    customer.talkUntil = elapsed + 4.2;
    customer.readyAt = elapsed + 1.9;
    if (customer.umbrella) tween(`fold${customer.root.id}`, 0, () => {}, () => setUmbrella(customer, false, 0.55), 1.45);
    tween('trayWait', 0, () => {}, () => slidePaper('in'), 1.5);
  }

  function leaveCustomer() {
    if (!isReady || !customer) return;
    const goer = customer;
    customer = null;
    setMood(goer, 'calm');
    setUmbrella(goer, true, 0.5);
    leaving.add(goer);
    walk(goer, EXIT_X, 1.3, () => {
      leaving.delete(goer);
      removePerson(goer);
    });
  }

  // Plays the booth's reaction to a submitted request: happy | boom | accused.
  function react(kind) {
    if (!isReady || !customer) return;
    const person = customer;
    slidePaper('out');
    if (kind === 'happy') {
      setMood(person, 'pleased');
      screenState = 'ok';
      beaconColor = 0x3ddc84;
      beaconUntil = elapsed + 1.2;
      tween('head', 1.1, (k) => { person.head.rotation.x = Math.sin(k * Math.PI * 4) * 0.12 * (1 - k); });
      return;
    }
    if (kind === 'refused') {
      // Turned away by the rules: annoyed, not raging, and no citation slip.
      setMood(person, 'annoyed');
      screenState = 'refused';
      beaconColor = 0xf5a524;
      beaconUntil = elapsed + 1.5;
      sound('refuse');
      tween('head', 1.2, (k) => { person.head.rotation.y = Math.sin(k * Math.PI * 4) * 0.2 * (1 - k); });
      return;
    }
    beaconColor = 0xff3344;
    beaconUntil = elapsed + 3;
    shakeLeft = 0.3;
    printer.slip.visible = true;
    sound('alarm');
    sound('printer', 0.4);
    tween('slip', 1.4, (k) => { printer.slip.scale.y = 0.001 + easeInOut(k); }, null, 0.4);
    if (kind === 'missed') {
      // The customer can't tell yet: they leave pleased. They come back later (storm).
      setMood(person, 'pleased');
      screenState = 'error';
      return;
    }
    screenState = 'blocked';
    rage(person, ['point', 'slam', 'throw', 'film']);
  }

  // The customer from a missed error comes back angry. Returns the length in ms.
  function storm(look) {
    if (!isReady) return 0;
    if (customer) {
      removePerson(customer);
      customer = null;
    }
    const person = buildPerson({ ...look, umbrella: false });
    customer = person;
    screenState = 'error';
    setMood(person, 'angry');
    walk(person, SPOT_X, 0.8, () => rage(person, ['bang', 'bang', 'slam', 'throw', 'film', 'point']));
    return isCalm ? 600 : 800 + 2900;
  }

  // Back to normal before the next customer.
  function calmDown() {
    if (!isReady) return;
    focusGoal = 0;
    screenState = 'idle';
    beaconUntil = 0;
    if (printer.slip.visible) {
      tween('slip', 0.3, (k) => { printer.slip.scale.y = 1 - k + 0.001; }, () => { printer.slip.visible = false; });
    }
  }

  // fn({ x, y } | null) is called every frame with the customer's head in view pixels.
  const watchCustomer = (fn) => { onAnchor = fn; };

  // 0 (whole booth) … 1 (close on the customer's face).
  const focusLevel = () => focus;

  // Start downloading character models; people use them once they arrive.
  const preload = (names) => { for (const name of names) loadModel(name).catch(() => {}); };

  // The customer speaks for about this long (mouth moves, hands gesture).
  function talk(seconds) {
    if (!isReady || !customer) return;
    customer.talkUntil = elapsed + seconds;
    customer.gestureAt = Math.min(customer.gestureAt, 0.3);
  }

  return { init, reset, preload, enterCustomer, leaveCustomer, react, storm, calmDown, setClock, watchCustomer, focusLevel, talk };
})();
