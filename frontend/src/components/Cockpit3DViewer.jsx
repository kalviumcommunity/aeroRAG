import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Compass, RotateCw, Eye, Navigation, Activity, ShieldCheck, AlertCircle } from 'lucide-react';

export default function Cockpit3DViewer({ 
  flightMode = 'CRUISE', 
  activeProcedure = null,
  altitude = 34000,
  airspeed = 285
}) {
  const mountRef = useRef(null);
  const [viewMode, setViewMode] = useState('JET'); // 'JET' | 'RADAR' | 'GYRO'
  const [isRotating, setIsRotating] = useState(true);
  const [pitch, setPitch] = useState(2.5); // degrees
  const [roll, setRoll] = useState(0.0);   // degrees
  const [heading, setHeading] = useState(274); // degrees

  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const objectsGroupRef = useRef(null);
  const animFrameIdRef = useRef(null);
  const isDraggingRef = useRef(false);
  const prevMousePosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount) return;

    const width = currentMount.clientWidth || 500;
    const height = currentMount.clientHeight || 340;

    // 1. Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.fog = new THREE.FogExp2(0x040711, 0.035);

    // 2. Camera setup
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 3, 8);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // 3. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    rendererRef.current = renderer;

    currentMount.innerHTML = '';
    currentMount.appendChild(renderer.domElement);

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0x00f0ff, 0.8);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight1.position.set(5, 10, 7);
    scene.add(dirLight1);

    const pointLight = new THREE.PointLight(0x00f0ff, 3, 20);
    pointLight.position.set(0, 0, 0);
    scene.add(pointLight);

    // 5. Container Group for dynamic elements
    const mainGroup = new THREE.Group();
    scene.add(mainGroup);
    objectsGroupRef.current = mainGroup;

    // Helper: Build 3D Jetliner Wireframe
    function buildJetliner() {
      const jet = new THREE.Group();

      // Fuselage (Streamlined cylinder)
      const fuseGeo = new THREE.CylinderGeometry(0.35, 0.35, 4.2, 16);
      fuseGeo.rotateX(Math.PI / 2);
      const fuseMat = new THREE.MeshStandardMaterial({
        color: 0x0a192f,
        wireframe: true,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.3
      });
      const fuselage = new THREE.Mesh(fuseGeo, fuseMat);
      jet.add(fuselage);

      // Nose Cone
      const noseGeo = new THREE.ConeGeometry(0.35, 0.9, 16);
      noseGeo.rotateX(-Math.PI / 2);
      const noseMat = new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        wireframe: true,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.8
      });
      const nose = new THREE.Mesh(noseGeo, noseMat);
      nose.position.set(0, 0, 2.5);
      jet.add(nose);

      // Main Swept Wings
      const wingShape = new THREE.Shape();
      wingShape.moveTo(0, 0);
      wingShape.lineTo(3.2, -1.2);
      wingShape.lineTo(3.0, -1.6);
      wingShape.lineTo(0, -0.6);
      wingShape.closePath();

      const extrudeSettings = { depth: 0.05, bevelEnabled: false };
      const rightWingGeo = new THREE.ExtrudeGeometry(wingShape, extrudeSettings);
      rightWingGeo.rotateX(Math.PI / 2);
      const wingMat = new THREE.MeshStandardMaterial({
        color: 0x0d213a,
        wireframe: true,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.4
      });

      const rightWing = new THREE.Mesh(rightWingGeo, wingMat);
      rightWing.position.set(0.2, 0, 0.6);
      jet.add(rightWing);

      // Left Wing (mirrored)
      const leftWingShape = new THREE.Shape();
      leftWingShape.moveTo(0, 0);
      leftWingShape.lineTo(-3.2, -1.2);
      leftWingShape.lineTo(-3.0, -1.6);
      leftWingShape.lineTo(0, -0.6);
      leftWingShape.closePath();

      const leftWingGeo = new THREE.ExtrudeGeometry(leftWingShape, extrudeSettings);
      leftWingGeo.rotateX(Math.PI / 2);
      const leftWing = new THREE.Mesh(leftWingGeo, wingMat);
      leftWing.position.set(-0.2, 0, 0.6);
      jet.add(leftWing);

      // Winglet Accents (Cyan Neon)
      const wingletMatR = new THREE.MeshBasicMaterial({ color: 0x00ff88 }); // Green right navigation light
      const wingletMatL = new THREE.MeshBasicMaterial({ color: 0xff3838 }); // Red left navigation light
      
      const navLightGeo = new THREE.SphereGeometry(0.08, 8, 8);
      const navR = new THREE.Mesh(navLightGeo, wingletMatR);
      navR.position.set(3.2, 0.1, -0.6);
      jet.add(navR);

      const navL = new THREE.Mesh(navLightGeo, wingletMatL);
      navL.position.set(-3.2, 0.1, -0.6);
      jet.add(navL);

      // Twin Turbofan Engines (Pylons under wings)
      const engineGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.8, 12);
      engineGeo.rotateX(Math.PI / 2);
      const engineMat = new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        wireframe: true,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.6
      });

      const rightEngine = new THREE.Mesh(engineGeo, engineMat);
      rightEngine.position.set(1.2, -0.3, 0.3);
      jet.add(rightEngine);

      const leftEngine = new THREE.Mesh(engineGeo, engineMat);
      leftEngine.position.set(-1.2, -0.3, 0.3);
      jet.add(leftEngine);

      // Vertical Stabilizer (Tail)
      const tailShape = new THREE.Shape();
      tailShape.moveTo(0, 0);
      tailShape.lineTo(0, 1.2);
      tailShape.lineTo(-0.6, 1.0);
      tailShape.lineTo(-1.1, 0);
      tailShape.closePath();

      const tailGeo = new THREE.ExtrudeGeometry(tailShape, extrudeSettings);
      tailGeo.rotateY(Math.PI / 2);
      const tail = new THREE.Mesh(tailGeo, wingMat);
      tail.position.set(0.025, 0.3, -1.2);
      jet.add(tail);

      // Horizontal Stabilizers
      const hStabGeo = new THREE.BoxGeometry(2.0, 0.04, 0.5);
      const hStab = new THREE.Mesh(hStabGeo, wingMat);
      hStab.position.set(0, 0.25, -2.0);
      jet.add(hStab);

      return jet;
    }

    // Helper: Build 3D Tactical Wireframe Radar Globe
    function buildTacticalRadar() {
      const radar = new THREE.Group();

      // Earth / Radar Sphere wireframe
      const sphereGeo = new THREE.SphereGeometry(2.2, 24, 24);
      const sphereMat = new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        wireframe: true,
        emissive: 0x005577,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.4
      });
      const globe = new THREE.Mesh(sphereGeo, sphereMat);
      radar.add(globe);

      // Equatorial & Latitude Rings
      const ringGeo = new THREE.RingGeometry(2.8, 2.85, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotateX(Math.PI / 2);
      radar.add(ring);

      // Radar Range Rings
      [1.5, 2.2, 3.2].forEach((radius, i) => {
        const rangeRingGeo = new THREE.RingGeometry(radius, radius + 0.03, 32);
        const rangeMat = new THREE.MeshBasicMaterial({
          color: i === 1 ? 0x00ff88 : 0x00f0ff,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.4 + i * 0.2
        });
        const rMesh = new THREE.Mesh(rangeRingGeo, rangeMat);
        rMesh.rotateX(Math.PI / 2);
        radar.add(rMesh);
      });

      // Waypoint Nodes (JFK, LHR, DXB, HND)
      const waypointMat = new THREE.MeshBasicMaterial({ color: 0xffb800 });
      const wpGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
      
      const waypoints = [
        [1.2, 1.4, 1.0],
        [-1.0, 1.6, 0.8],
        [1.5, 0.3, 1.4],
        [-1.8, 0.8, -0.9]
      ];

      waypoints.forEach(pos => {
        const wp = new THREE.Mesh(wpGeo, waypointMat);
        wp.position.set(...pos);
        radar.add(wp);
      });

      return radar;
    }

    // Helper: Build 3D Gyroscope Attitude Sphere
    function buildGyroscope() {
      const gyro = new THREE.Group();

      // Outer Pitch Gimbal Ring
      const gimbalGeo1 = new THREE.TorusGeometry(2.2, 0.06, 16, 64);
      const gimbalMat1 = new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.5,
        wireframe: true
      });
      const g1 = new THREE.Mesh(gimbalGeo1, gimbalMat1);
      gyro.add(g1);

      // Inner Roll Gimbal Ring
      const gimbalGeo2 = new THREE.TorusGeometry(1.9, 0.05, 16, 64);
      const gimbalMat2 = new THREE.MeshStandardMaterial({
        color: 0xffb800,
        emissive: 0xffb800,
        emissiveIntensity: 0.5,
        wireframe: true
      });
      const g2 = new THREE.Mesh(gimbalGeo2, gimbalMat2);
      g2.rotateY(Math.PI / 2);
      gyro.add(g2);

      // Artificial Horizon Core Indicator
      const sphereGeo = new THREE.SphereGeometry(1.6, 16, 16);
      const sphereMat = new THREE.MeshStandardMaterial({
        color: 0x091b34,
        wireframe: true,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.2
      });
      const core = new THREE.Mesh(sphereGeo, sphereMat);
      gyro.add(core);

      return gyro;
    }

    // Assemble active object based on viewMode
    mainGroup.clear();
    if (viewMode === 'JET') {
      mainGroup.add(buildJetliner());
      camera.position.set(0, 2.5, 6.5);
    } else if (viewMode === 'RADAR') {
      mainGroup.add(buildTacticalRadar());
      camera.position.set(0, 3.5, 6.5);
    } else {
      mainGroup.add(buildGyroscope());
      camera.position.set(0, 2.5, 6.0);
    }

    // 6. Animation Loop
    let clock = new THREE.Clock();
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);

      const elapsed = clock.getElapsedTime();

      if (mainGroup) {
        if (isRotating && !isDraggingRef.current) {
          mainGroup.rotation.y += 0.007;
        }

        // Apply Flight Mode dynamics
        if (viewMode === 'JET') {
          if (activeProcedure?.toLowerCase().includes('emergency descent')) {
            mainGroup.rotation.x = 0.35; // Steep descent pitch
            mainGroup.rotation.z = Math.sin(elapsed * 2) * 0.08;
          } else if (activeProcedure?.toLowerCase().includes('go around')) {
            mainGroup.rotation.x = -0.30; // Climb pitch
            mainGroup.rotation.z = Math.sin(elapsed) * 0.05;
          } else {
            // Smooth cruising micro-flutter
            mainGroup.rotation.x = Math.sin(elapsed * 0.8) * 0.04 + (pitch * Math.PI) / 180;
            mainGroup.rotation.z = Math.cos(elapsed * 0.6) * 0.03 + (roll * Math.PI) / 180;
          }
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    // 7. Mouse Drag Interactions for 3D Orbiting
    const onMouseDown = (e) => {
      isDraggingRef.current = true;
      prevMousePosRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e) => {
      if (!isDraggingRef.current || !mainGroup) return;
      const deltaX = e.clientX - prevMousePosRef.current.x;
      const deltaY = e.clientY - prevMousePosRef.current.y;

      mainGroup.rotation.y += deltaX * 0.01;
      mainGroup.rotation.x += deltaY * 0.01;

      prevMousePosRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    const domElement = renderer.domElement;
    domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // Resize Handler
    const handleResize = () => {
      if (!currentMount) return;
      const w = currentMount.clientWidth;
      const h = currentMount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animFrameIdRef.current);
      window.removeEventListener('resize', handleResize);
      domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (currentMount && renderer.domElement) {
        currentMount.innerHTML = '';
      }
      renderer.dispose();
    };
  }, [viewMode, isRotating, activeProcedure]);

  return (
    <div className="relative glass-panel rounded-xl overflow-hidden border border-cyan-500/30 flex flex-col h-full min-h-[380px]">
      {/* Top HUD Telemetry Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-black/40 border-b border-cyan-500/20 backdrop-blur-md z-10">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping"></div>
          <span className="font-orbitron text-xs font-bold text-cyan-400 tracking-wider">
            3D COCKPIT TELEMETRY
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 font-mono-code border border-cyan-800">
            B737-MAX
          </span>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-1 bg-slate-900/80 p-0.5 rounded-lg border border-slate-700">
          <button
            onClick={() => setViewMode('JET')}
            className={`px-2 py-1 text-xs font-semibold rounded flex items-center gap-1 transition-all ${
              viewMode === 'JET'
                ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/40'
                : 'text-slate-400 hover:text-cyan-300'
            }`}
          >
            <Navigation className="w-3 h-3" /> 3D Jet
          </button>
          <button
            onClick={() => setViewMode('RADAR')}
            className={`px-2 py-1 text-xs font-semibold rounded flex items-center gap-1 transition-all ${
              viewMode === 'RADAR'
                ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/40'
                : 'text-slate-400 hover:text-cyan-300'
            }`}
          >
            <Activity className="w-3 h-3" /> Global Radar
          </button>
          <button
            onClick={() => setViewMode('GYRO')}
            className={`px-2 py-1 text-xs font-semibold rounded flex items-center gap-1 transition-all ${
              viewMode === 'GYRO'
                ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/40'
                : 'text-slate-400 hover:text-cyan-300'
            }`}
          >
            <Compass className="w-3 h-3" /> Gyroscope
          </button>
        </div>
      </div>

      {/* Main 3D Canvas Area */}
      <div className="relative flex-1 w-full h-full min-h-[290px] cursor-grab active:cursor-grabbing">
        {/* Three.js Canvas Mount */}
        <div ref={mountRef} className="absolute inset-0 w-full h-full" />

        {/* Tactical Cockpit HUD Overlay Elements */}
        <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between">
          {/* Top Compass Heading Tape */}
          <div className="flex justify-center items-center">
            <div className="bg-black/60 border border-cyan-500/30 px-3 py-1 rounded-md text-xs font-mono-code text-cyan-300 flex items-center gap-2">
              <Compass className="w-3.5 h-3.5 text-cyan-400 animate-spin" style={{ animationDuration: '10s' }} />
              <span>HDG: <strong className="text-white">274° MAG</strong></span>
              <span className="text-slate-600">|</span>
              <span>WPT: <strong className="text-amber-400">BAYEN</strong></span>
            </div>
          </div>

          {/* Center Reticle / Artificial Horizon Crosshair */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-24 h-24 border border-cyan-500/20 rounded-full flex items-center justify-center">
              <div className="w-12 h-0.5 bg-cyan-400/40"></div>
              <div className="w-2 h-2 rounded-full border border-cyan-400 bg-transparent"></div>
              <div className="w-12 h-0.5 bg-cyan-400/40"></div>
            </div>
          </div>

          {/* Bottom Telemetry Flight Readouts */}
          <div className="flex items-end justify-between">
            {/* Speed Tape Display */}
            <div className="bg-black/70 border border-cyan-500/40 rounded-lg p-2 font-mono-code text-xs backdrop-blur-sm">
              <div className="text-[10px] text-slate-400">AIRSPEED (IAS)</div>
              <div className="text-xl font-bold font-orbitron text-cyan-400">
                {airspeed} <span className="text-xs font-normal text-slate-400">KTS</span>
              </div>
              <div className="text-[11px] text-emerald-400">MACH 0.784</div>
            </div>

            {/* Flight Mode Indicator */}
            <div className="text-center px-3 py-1 rounded bg-black/60 border border-slate-700">
              <div className="text-[10px] text-slate-400 tracking-widest uppercase">EN-ROUTE STATUS</div>
              <div className="text-xs font-bold font-orbitron text-cyan-300">
                {activeProcedure ? 'CHECKLIST ACTIVE' : 'LNAV / VNAV CRUISE'}
              </div>
            </div>

            {/* Altitude Tape Display */}
            <div className="bg-black/70 border border-cyan-500/40 rounded-lg p-2 font-mono-code text-xs text-right backdrop-blur-sm">
              <div className="text-[10px] text-slate-400">PRESSURE ALT</div>
              <div className="text-xl font-bold font-orbitron text-cyan-400">
                {altitude.toLocaleString()} <span className="text-xs font-normal text-slate-400">FT</span>
              </div>
              <div className="text-[11px] text-amber-400">FL 340 (STD)</div>
            </div>
          </div>
        </div>

        {/* Bottom Interactive Controls */}
        <div className="absolute top-3 left-3 z-10 flex gap-1.5">
          <button
            onClick={() => setIsRotating(!isRotating)}
            className={`p-1.5 rounded bg-black/70 border border-cyan-500/30 text-xs flex items-center gap-1 transition-all ${
              isRotating ? 'text-cyan-400' : 'text-slate-400'
            }`}
            title="Toggle Auto-Rotation"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isRotating ? 'animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
            <span className="text-[10px] font-mono-code">{isRotating ? 'AUTO' : 'MANUAL'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

