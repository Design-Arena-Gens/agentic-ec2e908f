"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Car, VEHICLE_PRESETS } from "@/lib/game/physics";
import { Track, TRACK_LIBRARY, createSunLight } from "@/lib/game/tracks";
import { createAIDrivers } from "@/lib/game/ai";
import { ParticleSystem } from "@/lib/game/particles";
import { ReplayPlayer, ReplayRecorder } from "@/lib/game/replay";

const MODE_CONFIG = {
  "time-trial": {
    label: "Time Trial",
    laps: 3,
    ai: 0,
    description: "Beat your best lap against the clock.",
  },
  championship: {
    label: "Championship",
    laps: 4,
    ai: 4,
    description: "Full grid racing across every circuit.",
  },
  elimination: {
    label: "Elimination",
    laps: 5,
    ai: 5,
    description: "Last place gets dropped every 45 seconds.",
  },
};

const INPUT_TEMPLATE = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: 0,
  boost: false,
};

const KEY_BINDINGS = {
  player1: {
    KeyW: { action: "throttle", value: 1 },
    KeyS: { action: "brake", value: 1 },
    KeyA: { action: "steer", value: -1 },
    KeyD: { action: "steer", value: 1 },
    Space: { action: "handbrake", value: 1 },
    ShiftLeft: { action: "boost", value: true },
  },
  player2: {
    ArrowUp: { action: "throttle", value: 1 },
    ArrowDown: { action: "brake", value: 1 },
    ArrowLeft: { action: "steer", value: -1 },
    ArrowRight: { action: "steer", value: 1 },
    Slash: { action: "handbrake", value: 1 },
    ShiftRight: { action: "boost", value: true },
  },
};

const INITIAL_HUD = {
  lap: 0,
  lapsTotal: 0,
  lapTime: 0,
  bestLap: 0,
  position: 1,
  speed: 0,
  mode: MODE_CONFIG["championship"].label,
  countdown: 0,
  stage: 1,
  trackName: "",
  weather: "",
  eliminated: [],
  message: "",
};

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "--:--.--";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${remaining.toFixed(2).padStart(5, "0")}`;
}

export default function Home() {
  return <RacingGame />;
}

function RacingGame() {
  const containerRef = useRef(null);
  const minimapRef = useRef(null);
  const gameRef = useRef(null);
  const controlsRef = useRef({
    player1: { ...INPUT_TEMPLATE },
    player2: { ...INPUT_TEMPLATE },
  });
  const [mode, setMode] = useState("championship");
  const [phase, setPhase] = useState("menu");
  const [hud, setHud] = useState(INITIAL_HUD);
  const [presetKey, setPresetKey] = useState("balanced");
  const [upgradeKey, setUpgradeKey] = useState("stock");
  const [color, setColor] = useState(
    VEHICLE_PRESETS.balanced.colorOptions[0],
  );
  const [championshipStage, setChampionshipStage] = useState(0);
  const [replayReady, setReplayReady] = useState(false);
  const [nightMode, setNightMode] = useState(false);

  const presetOptions = useMemo(() => Object.entries(VEHICLE_PRESETS), []);

  useEffect(() => {
    setHud((prev) => ({
      ...prev,
      mode: MODE_CONFIG[mode].label,
    }));
  }, [mode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0f111c");
    scene.fog = new THREE.Fog("#0f111c", 80, 380);

    const cameraPrimary = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
    const cameraSecondary = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
    const cameraReplay = new THREE.PerspectiveCamera(70, 1, 0.1, 1600);
    const minimapCamera = new THREE.OrthographicCamera(-160, 160, 160, -160, 10, 2000);
    minimapCamera.position.set(0, 600, 0);
    minimapCamera.lookAt(0, 0, 0);

    const ambientLight = new THREE.AmbientLight("#f6f7ff", 0.7);
    const sunLight = createSunLight();
    scene.add(ambientLight);
    scene.add(sunLight);

    const particleSystem = new ParticleSystem(scene);
    const replayRecorder = new ReplayRecorder();
    const replayPlayer = new ReplayPlayer(replayRecorder);

    const clock = new THREE.Clock();
    clock.start();

    const state = {
      renderer,
      scene,
      cameras: { cameraPrimary, cameraSecondary, cameraReplay, minimapCamera },
      lights: { ambientLight, sunLight },
      particleSystem,
      replay: { recorder: replayRecorder, player: replayPlayer },
      clock,
      track: null,
      trackGroup: null,
      nightLights: null,
      cars: [],
      players: [],
      ai: [],
      race: {
        mode: mode,
        status: "idle",
        lapTarget: MODE_CONFIG[mode].laps,
        time: 0,
        elapsed: 0,
        eliminationTimer: 45,
        eliminated: [],
        podium: [],
        countdown: 0,
        startTimestamp: 0,
        stage: 0,
        eliminationInterval: 45,
      },
      timeOfDay: 9,
      animationId: 0,
      lastHudUpdate: 0,
      leaderboard: [],
    };

    gameRef.current = state;

    function resize() {
      const { clientWidth, clientHeight } = container;
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(clientWidth, clientHeight);
      const halfHeight = Math.max(clientHeight / 2, 1);
      cameraPrimary.aspect = clientWidth / halfHeight;
      cameraPrimary.updateProjectionMatrix();
      cameraSecondary.aspect = clientWidth / halfHeight;
      cameraSecondary.updateProjectionMatrix();
      cameraReplay.aspect = clientWidth / clientHeight;
      cameraReplay.updateProjectionMatrix();
    }

    resize();
    window.addEventListener("resize", resize);

    function updateDayNight(delta) {
      state.timeOfDay = (state.timeOfDay + delta * 0.06) % 24;
      const daylight = Math.cos((state.timeOfDay / 24) * Math.PI * 2) * 0.5 + 0.5;
      ambientLight.intensity = THREE.MathUtils.lerp(0.2, 0.8, daylight);
      sunLight.intensity = THREE.MathUtils.lerp(0.1, 1.2, daylight);
      sunLight.position.set(
        Math.sin((state.timeOfDay / 24) * Math.PI * 2) * 180,
        THREE.MathUtils.lerp(40, 160, daylight),
        Math.cos((state.timeOfDay / 24) * Math.PI * 2) * 180,
      );
      const skyColor = new THREE.Color("#071028").lerp(
        new THREE.Color("#78b7ff"),
        daylight,
      );
      scene.background.copy(skyColor);
      scene.fog.color.copy(skyColor.clone().lerp(new THREE.Color("#0b0d13"), 0.4));
      if (state.track) {
        if (daylight < 0.2 && !state.nightLights) {
          state.nightLights = state.track.buildNightLights();
          scene.add(state.nightLights);
        } else if (daylight > 0.35 && state.nightLights) {
          scene.remove(state.nightLights);
          state.nightLights = null;
        }
      }
      setNightMode(daylight < 0.25);
    }

    function updateRace(dt) {
      const { race, track, cars, ai, replay, particleSystem } = state;
      if (!track || cars.length === 0) return;

      race.elapsed += dt;
      if (race.status === "replay") {
        const frame = replay.player.step(dt, cars);
        if (!frame) return;
        updateCameras(dt);
        renderer.setScissorTest(true);
        const { clientWidth, clientHeight } = container;
        renderer.setViewport(0, 0, clientWidth, clientHeight);
        renderer.setScissor(0, 0, clientWidth, clientHeight);
        renderer.render(scene, state.cameras.cameraReplay);
        renderer.setScissorTest(false);
        return;
      }

      replay.recorder.record(race.elapsed, cars);

      const inputs = [];
      state.players.forEach((player) => {
        inputs.push(controlsRef.current[player.id]);
      });
      ai.forEach((driver, idx) => {
        const car = cars[state.players.length + idx];
        const input = driver.update(car, track, dt, {
          opponents: cars,
        });
        inputs.push(input);
      });

      cars.forEach((car, idx) => {
        const input = inputs[idx] ?? INPUT_TEMPLATE;
        if (race.status === "countdown") {
          const eased = Math.max(0, (3 - race.countdown) / 3);
          car.update(dt, { ...input, throttle: eased * input.throttle * 0.4 }, track, track.config.weather);
        } else if (race.status === "running") {
          car.update(dt, input, track, track.config.weather);
        }
      });

      if (race.status === "running") {
        particleSystem.update(dt);
        cars.forEach((car, idx) => {
          if (car.speed > 25 && Math.abs(car.velocity.dot(car.getSideVector())) > 2) {
            particleSystem.spawnTireSmoke(car);
          }
          if (idx < state.players.length && controlsRef.current[`player${idx + 1}`].boost) {
            particleSystem.spawnEngineFlare(car);
          }
        });
      } else {
        particleSystem.update(dt);
      }

      updateLapLogic(dt);
      updateLeaderboard();
      updateCameras(dt);
      updateHUD(dt);
      drawMinimap();
      handleElimination(dt);
    }

    function updateLapLogic(dt) {
      const { race, cars, track } = state;
      cars.forEach((car) => {
        const prevProgress = car.progress;
        car.progress = track.getProgress(car.position);
        if (!car.finished && prevProgress > 0.9 && car.progress < 0.1) {
          car.currentLap += 1;
          car.lastLapTime = car.totalLapTime;
          car.bestLap = Math.min(car.bestLap, car.lastLapTime);
          car.totalLapTime = 0;
          if (car.currentLap >= race.lapTarget) {
            car.finished = true;
            race.podium.push(car.name);
            if (state.players.some((p) => p.name === car.name)) {
              replay.recorder.stop();
              setReplayReady(true);
            }
            if (race.podium.length === state.players.length + state.ai.length) {
              finishRace();
            }
          }
        }
      });
    }

    function updateLeaderboard() {
      const { cars } = state;
      const leaderboard = [...cars]
        .map((car) => ({
          car,
          lap: car.currentLap,
          progress: car.progress,
          distance: car.distanceTravelled,
        }))
        .sort((a, b) => {
          if (a.car.finished && b.car.finished) return a.car.lastLapTime - b.car.lastLapTime;
          if (a.car.finished) return -1;
          if (b.car.finished) return 1;
          if (a.lap !== b.lap) return b.lap - a.lap;
          if (Math.abs(a.progress - b.progress) > 0.02) {
            return b.progress - a.progress;
          }
          return b.distance - a.distance;
        });
      state.leaderboard = leaderboard;
    }

    function updateCameras(dt) {
      const { cars, cameras, race } = state;
      if (!cars.length) return;
      const [playerOne, playerTwo] = cars;
      const chaseOffset = new THREE.Vector3(0, 6, 12);

      function positionCamera(camera, car, blend = 0.12) {
        const forward = car.getForwardVector();
        const targetPosition = car.position
          .clone()
          .addScaledVector(forward, -chaseOffset.z)
          .add(new THREE.Vector3(0, chaseOffset.y, 0));
        camera.position.lerp(targetPosition, blend);
        const lookTarget = car.position.clone().add(forward.clone().multiplyScalar(3));
        camera.lookAt(lookTarget);
      }

      if (race.status === "replay") {
        const mode = state.replay.player.cameraMode;
        if (mode === "chase") {
          positionCamera(cameras.cameraReplay, cars[0], 0.08);
        } else if (mode === "orbit") {
          const orbit = cars[0].position.clone().add(new THREE.Vector3(0, 16, 0));
          cameras.cameraReplay.position.lerp(orbit, 0.05);
          cameras.cameraReplay.lookAt(cars[0].position);
        } else {
          const t = (performance.now() * 0.0002) % 1;
          const point = state.track.curve.getPointAt(t);
          const ahead = state.track.curve.getPointAt((t + 0.02) % 1);
          cameras.cameraReplay.position.lerp(
            point.clone().add(new THREE.Vector3(0, 18, 0)),
            0.07,
          );
          cameras.cameraReplay.lookAt(ahead);
        }
        return;
      }

      positionCamera(cameras.cameraPrimary, playerOne);
      if (state.players.length > 1) {
        positionCamera(cameras.cameraSecondary, playerTwo ?? playerOne);
      } else {
        const spectator = state.leaderboard[1]?.car ?? playerOne;
        positionCamera(cameras.cameraSecondary, spectator, 0.1);
      }
    }

    function handleElimination(dt) {
      const { race, leaderboard, cars } = state;
      if (race.mode !== "elimination" || race.status !== "running") return;
      race.eliminationTimer -= dt;
      if (race.eliminationTimer <= 0) {
        const candidate = leaderboard[leaderboard.length - 1]?.car;
        if (candidate && !candidate.finished) {
          candidate.finished = true;
          race.eliminated.push(candidate.name);
          candidate.applyDamage(100);
          race.eliminationTimer = race.eliminationInterval;
          if (cars.filter((c) => !c.finished).length <= 1) {
            finishRace();
          }
        }
      }
    }

    function updateHUD(dt) {
      const now = state.clock.elapsedTime;
      if (now - state.lastHudUpdate < 0.08) return;
      state.lastHudUpdate = now;
      if (!state.players.length) return;
      const player = state.players[0];
      const car = state.cars[0];
      const position =
        state.leaderboard.findIndex((item) => item.car === car) + 1 || 1;
      setHud((prev) => ({
        ...prev,
        mode: MODE_CONFIG[state.race.mode]?.label ?? prev.mode,
        lap: car.currentLap + 1,
        lapsTotal: state.race.lapTarget,
        lapTime: car.totalLapTime,
        bestLap: car.bestLap,
        position,
        speed: car.speed * 3.6,
        countdown: state.race.status === "countdown" ? state.race.countdown : 0,
        trackName: state.track?.config.name ?? "",
        weather: state.track?.config.weather.particle ?? "clear",
        stage: state.race.stage + 1,
        eliminated: [...state.race.eliminated],
        message:
          state.race.status === "finished"
            ? "Race Complete - Watch Replay!"
            : "",
      }));
    }

    function drawMinimap() {
      const canvas = minimapRef.current;
      if (!canvas || !state.track) return;
      const ctx = canvas.getContext("2d");
      const size = canvas.width;
      ctx.fillStyle = "#02040c";
      ctx.fillRect(0, 0, size, size);

      const points = state.track.curve.getSpacedPoints(120);
      ctx.strokeStyle = "#3b9dff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      points.forEach((pt, idx) => {
        const x = size / 2 + pt.x * 0.6;
        const y = size / 2 + pt.z * 0.6;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();

      state.cars.forEach((car, idx) => {
        const x = size / 2 + car.position.x * 0.6;
        const y = size / 2 + car.position.z * 0.6;
        ctx.fillStyle = idx === 0 ? "#ffffff" : idx === 1 ? "#ff5a5f" : "#37ff8b";
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    function finishRace() {
      state.race.status = "finished";
      setPhase("results");
    }

    function animate() {
      state.animationId = renderer.setAnimationLoop(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!state.track) return;
      updateDayNight(dt);
      if (state.race.status === "countdown") {
        state.race.countdown = Math.max(0, state.race.countdown - dt);
        if (state.race.countdown <= 0) {
          state.race.status = "running";
        }
      }
      updateRace(dt);
      renderViews();
    }

    function renderViews() {
      const { renderer, cameras, race } = state;
      const { clientWidth, clientHeight } = container;
      if (race.status === "replay") {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, clientWidth, clientHeight);
        renderer.render(scene, cameras.cameraReplay);
        return;
      }

      renderer.setScissorTest(true);
      const halfHeight = Math.floor(clientHeight / 2);

      renderer.setViewport(0, halfHeight, clientWidth, halfHeight);
      renderer.setScissor(0, halfHeight, clientWidth, halfHeight);
      renderer.render(scene, cameras.cameraPrimary);

      renderer.setViewport(0, 0, clientWidth, halfHeight);
      renderer.setScissor(0, 0, clientWidth, halfHeight);
      renderer.render(scene, cameras.cameraSecondary);
      renderer.setScissorTest(false);
    }

    animate();

    function cleanup() {
      window.removeEventListener("resize", resize);
      renderer.setAnimationLoop(null);
      Object.values(state.cameras).forEach((camera) => camera.removeFromParent?.());
      particleSystem.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    }

    return cleanup;
  }, [mode]);

  useEffect(() => {
    function handleKeyDown(event) {
      Object.entries(KEY_BINDINGS).forEach(([playerKey, bindings]) => {
        const bind = bindings[event.code];
        if (!bind) return;
        const control = controlsRef.current[playerKey];
        if (bind.action === "steer") {
          control.steer = bind.value;
        } else if (bind.action === "boost") {
          control.boost = true;
        } else {
          control[bind.action] = bind.value;
        }
      });
    }
    function handleKeyUp(event) {
      Object.entries(KEY_BINDINGS).forEach(([playerKey, bindings]) => {
        const bind = bindings[event.code];
        if (!bind) return;
        const control = controlsRef.current[playerKey];
        if (bind.action === "steer") {
          if (
            (bind.value < 0 && control.steer < 0) ||
            (bind.value > 0 && control.steer > 0)
          ) {
            control.steer = 0;
          }
        } else if (bind.action === "boost") {
          control.boost = false;
        } else {
          control[bind.action] = 0;
        }
      });
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  function prepareRace({ stageIndex = 0 } = {}) {
    const engine = gameRef.current;
    if (!engine) return;
    const { scene } = engine;

    if (engine.trackGroup) {
      scene.remove(engine.trackGroup);
    }
    if (engine.nightLights) {
      scene.remove(engine.nightLights);
      engine.nightLights = null;
    }

    const trackConfig =
      TRACK_LIBRARY[(championshipStage + stageIndex) % TRACK_LIBRARY.length];
    const track = new Track(trackConfig);
    const trackGroup = track.buildScene();
    scene.add(trackGroup);
    engine.trackGroup = trackGroup;
    engine.track = track;
    engine.race = {
      ...engine.race,
      status: "countdown",
      mode,
      lapTarget: MODE_CONFIG[mode].laps,
      countdown: 3,
      elapsed: 0,
      eliminated: [],
      podium: [],
      stage: stageIndex,
      eliminationTimer: MODE_CONFIG[mode].laps > 0 ? 45 : 0,
    };
    if (engine.cars.length) {
      engine.cars.forEach((car) => {
        scene.remove(car.mesh);
      });
    }
    engine.cars = [];
    engine.players = [];
    engine.ai = [];
    engine.leaderboard = [];
    engine.replay.recorder.start(engine.clock.elapsedTime);
    engine.replay.player.stop();
    setReplayReady(false);
    controlsRef.current.player1 = { ...INPUT_TEMPLATE };
    controlsRef.current.player2 = { ...INPUT_TEMPLATE };

    const totalAI = MODE_CONFIG[mode].ai;
    const players = [
      new Car({ color, name: "Player One" }),
      new Car({
        color: "#4ee1ff",
        name: "Player Two",
      }),
    ];
    players[0].setUpgrade(upgradeKey, presetKey);
    players[1].setUpgrade("stock", "lightweight");
    engine.players = [
      { id: "player1", name: "Player One", car: players[0] },
      { id: "player2", name: "Player Two", car: players[1] },
    ];

    engine.cars.push(...players);
    players.forEach((car, index) => {
      const spawn = track.getSpawnPoint(index);
      car.reset(spawn.position, spawn.yaw);
      scene.add(car.mesh);
    });

    const aiDrivers = createAIDrivers(totalAI, mode === "championship" ? "pro" : mode === "elimination" ? "elite" : "rookie");
    aiDrivers.forEach((driver, idx) => {
      const aiCar = new Car({
        color: `hsl(${Math.random() * 360}, 70%, 55%)`,
        name: driver.name,
      });
      aiCar.setUpgrade(idx % 2 === 0 ? "performance" : "stock", "balanced");
      const spawn = track.getSpawnPoint(engine.cars.length);
      aiCar.reset(spawn.position, spawn.yaw);
      engine.cars.push(aiCar);
      scene.add(aiCar.mesh);
    });
    engine.ai = aiDrivers;

    engine.particleSystem.setWeather(track.config.weather);
    setHud((prev) => ({
      ...prev,
      mode: MODE_CONFIG[mode].label,
      lapsTotal: engine.race.lapTarget,
      lap: 1,
      bestLap: 0,
      lapTime: 0,
      position: 1,
      trackName: track.config.name,
      stage: stageIndex + 1,
      countdown: 3,
      eliminated: [],
      message: "Get Ready!",
    }));
    setPhase("countdown");
  }

  function startReplay() {
    const engine = gameRef.current;
    if (!engine || !replayReady) return;
    const started = engine.replay.player.start(1);
    if (!started) return;
    engine.race.status = "replay";
    setPhase("replay");
  }

  function toggleReplayCamera() {
    const engine = gameRef.current;
    if (!engine) return;
    const mode = engine.replay.player.toggleCameraMode();
    setHud((prev) => ({
      ...prev,
      message: `Replay camera: ${mode}`,
    }));
  }

  function restartFromMenu() {
    const engine = gameRef.current;
    if (engine) {
      if (engine.trackGroup) {
        engine.scene.remove(engine.trackGroup);
        engine.trackGroup = null;
      }
      if (engine.nightLights) {
        engine.scene.remove(engine.nightLights);
        engine.nightLights = null;
      }
      engine.cars.forEach((car) => {
        engine.scene.remove(car.mesh);
      });
      engine.cars = [];
      engine.players = [];
      engine.ai = [];
    }
    setPhase("menu");
    setChampionshipStage(0);
    setHud({ ...INITIAL_HUD, mode: MODE_CONFIG[mode].label });
  }

  useEffect(() => {
    if (phase !== "countdown") return;
    const countdownInterval = setInterval(() => {
      setHud((prev) => ({
        ...prev,
        countdown: Math.max(0, prev.countdown - 1),
        message: prev.countdown <= 1 ? "Go!" : prev.message,
      }));
    }, 1000);
    return () => clearInterval(countdownInterval);
  }, [phase]);

  return (
    <div
      className={`relative min-h-screen w-full overflow-hidden ${
        nightMode ? "bg-slate-950" : "bg-sky-900"
      } text-white`}
    >
      {phase === "menu" && (
        <div className="absolute inset-0 z-20 grid place-content-center bg-black/80 px-6 py-10">
          <div className="max-w-3xl rounded-3xl border border-white/15 bg-slate-900/80 p-10 shadow-2xl backdrop-blur">
            <h1 className="text-4xl font-bold tracking-tight text-cyan-200">
              Velocity Apex
            </h1>
            <p className="mt-2 text-lg text-slate-200/80">
              Strap in for an all-new Three.js racing experience. Configure
              your machine, pick a mode, and conquer the grid.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
              {Object.entries(MODE_CONFIG).map(([key, value]) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={`rounded-2xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                    mode === key
                      ? "border-cyan-400 bg-cyan-500/10"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <h2 className="text-xl font-semibold text-white">
                    {value.label}
                  </h2>
                  <p className="mt-2 text-sm text-slate-200/70">
                    {value.description}
                  </p>
                  <div className="mt-3 text-xs uppercase tracking-widest text-cyan-200/70">
                    {value.laps} Laps · {value.ai} AI
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
              <h3 className="text-xl font-semibold text-white">Car Setup</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-sm uppercase tracking-widest text-cyan-200/70">
                    Vehicle
                  </label>
                  <select
                    value={presetKey}
                    onChange={(e) => {
                      const preset = e.target.value;
                      setPresetKey(preset);
                      const colors =
                        VEHICLE_PRESETS[preset].colorOptions ?? [];
                      setColor(colors[0] ?? "#ffffff");
                      setUpgradeKey(
                        Object.keys(VEHICLE_PRESETS[preset].upgrades)[0],
                      );
                    }}
                    className="mt-1 w-full rounded-xl border border-white/20 bg-slate-950/80 px-3 py-2 text-white focus:border-cyan-400 focus:outline-none"
                  >
                    {presetOptions.map(([key, preset]) => (
                      <option key={key} value={key}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm uppercase tracking-widest text-cyan-200/70">
                    Upgrade
                  </label>
                  <select
                    value={upgradeKey}
                    onChange={(e) => setUpgradeKey(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/20 bg-slate-950/80 px-3 py-2 text-white focus:border-cyan-400 focus:outline-none"
                  >
                    {Object.entries(
                      VEHICLE_PRESETS[presetKey].upgrades,
                    ).map(([key, upgrade]) => (
                      <option key={key} value={key}>
                        {upgrade.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm uppercase tracking-widest text-cyan-200/70">
                    Paint
                  </label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {VEHICLE_PRESETS[presetKey].colorOptions.map((swatch) => (
                      <button
                        key={swatch}
                        onClick={() => setColor(swatch)}
                        className={`h-10 w-10 rounded-full border-2 transition ${
                          color === swatch
                            ? "border-white"
                            : "border-white/30 opacity-60 hover:opacity-100"
                        }`}
                        style={{ backgroundColor: swatch }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
              <div className="text-xs text-slate-200/60">
                Player 1: WASD + Shift (boost), Space (handbrake). Player 2:
                Arrow Keys + Shift + "/" (handbrake).
              </div>
              <button
                onClick={() => {
                  prepareRace({ stageIndex: 0 });
                  setPhase("countdown");
                }}
                className="rounded-2xl border border-cyan-400 bg-cyan-500/20 px-6 py-3 text-lg font-semibold uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-400/30"
              >
                Launch Race
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={containerRef} className="relative h-screen w-full">
        <canvas
          ref={minimapRef}
          width={240}
          height={240}
          className="absolute right-4 top-4 z-10 rounded-xl border border-white/20 bg-black/60 p-2"
        />
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between">
          <div className="flex justify-between p-4">
            <div className="rounded-2xl border border-white/10 bg-black/60 px-4 py-3">
              <div className="text-xs uppercase tracking-widest text-cyan-200/80">
                {hud.mode}
              </div>
              <div className="text-xl font-semibold">{hud.trackName}</div>
              <div className="mt-1 text-xs text-slate-200/70">
                Weather: {hud.weather}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-right">
              <div className="text-xs uppercase tracking-widest text-cyan-200/80">
                Lap
              </div>
              <div className="text-2xl font-semibold">
                {hud.lap}/{hud.lapsTotal}
              </div>
              <div className="mt-1 text-xs text-slate-200/70">
                Best {formatTime(hud.bestLap)}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="rounded-2xl border border-white/10 bg-black/60 px-4 py-3">
              <div className="text-xs uppercase tracking-widest text-cyan-200/80">
                Speed
              </div>
              <div className="text-4xl font-bold">
                {Math.round(hud.speed)} km/h
              </div>
              {phase === "countdown" && (
                <div className="mt-1 text-lg font-semibold text-cyan-200">
                  {hud.countdown > 0 ? hud.countdown : "GO!"}
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-right">
              <div className="text-xs uppercase tracking-widest text-cyan-200/80">
                Position
              </div>
              <div className="text-2xl font-semibold">
                {hud.position} / {gameRef.current?.cars.length ?? 0}
              </div>
              <div className="mt-1 text-xs text-slate-200/70">
                Lap Time {formatTime(hud.lapTime)}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="rounded-2xl border border-white/10 bg-black/60 px-4 py-3">
              <div className="text-xs uppercase tracking-widest text-cyan-200/80">
                Stage
              </div>
              <div className="text-xl font-semibold">#{hud.stage}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-right">
              <div className="text-xs uppercase tracking-widest text-cyan-200/80">
                Status
              </div>
              <div className="text-sm font-semibold text-cyan-100">
                {hud.message}
              </div>
              {hud.eliminated.length > 0 && (
                <div className="mt-1 text-xs text-rose-300">
                  Eliminated: {hud.eliminated.join(", ")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {phase === "results" && (
        <div className="absolute inset-0 z-20 grid place-content-center bg-black/80 px-6 py-10">
          <div className="w-full max-w-2xl rounded-3xl border border-white/15 bg-slate-900/90 p-10 shadow-2xl backdrop-blur">
            <h2 className="text-3xl font-bold text-white">Race Complete</h2>
            <p className="mt-2 text-slate-200/80">
              {gameRef.current?.race.mode === "championship"
                ? "On to the next circuit."
                : "Fancy a replay?"}
            </p>

            <div className="mt-6 space-y-3">
              {gameRef.current?.leaderboard?.map(({ car }, idx) => (
                <div
                  key={car.name}
                  className={`flex items-center justify-between rounded-xl border border-white/10 px-4 py-2 ${
                    idx === 0 ? "bg-amber-400/20" : "bg-white/5"
                  }`}
                >
                  <div className="text-lg font-semibold">
                    #{idx + 1} {car.name}
                  </div>
                  <div className="text-sm text-slate-200/70">
                    Best {formatTime(car.bestLap)}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap justify-end gap-4">
              {replayReady && (
                <button
                  onClick={startReplay}
                  className="rounded-xl border border-cyan-400 bg-cyan-500/20 px-4 py-2 text-sm font-semibold uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-400/30"
                >
                  Watch Replay
                </button>
              )}
              <button
                onClick={() => {
                  setChampionshipStage((prev) => prev + 1);
                  prepareRace({ stageIndex: championshipStage + 1 });
                }}
                className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold uppercase tracking-widest text-white transition hover:bg-white/15"
              >
                Next Race
              </button>
              <button
                onClick={restartFromMenu}
                className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold uppercase tracking-widest text-white transition hover:bg-white/15"
              >
                Back to Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "replay" && (
        <div className="absolute inset-x-0 bottom-6 z-20 mx-auto flex w-fit items-center gap-6 rounded-full border border-white/10 bg-black/60 px-6 py-3 text-sm uppercase tracking-widest text-white/80">
          <span>Replay Mode Active</span>
          <button
            onClick={toggleReplayCamera}
            className="rounded-full border border-white/30 px-4 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-400"
          >
            Switch Camera
          </button>
          <button
            onClick={restartFromMenu}
            className="rounded-full border border-white/30 px-4 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-400"
          >
            Exit Replay
          </button>
        </div>
      )}
    </div>
  );
}
