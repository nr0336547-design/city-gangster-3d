import * as THREE from 'three';

export class CityGame {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly keyboard = new Set<string>();
  private readonly obstacles: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  private readonly trafficCars: Array<{ mesh: THREE.Group; axis: 'x' | 'z'; speed: number }> = [];
  private readonly pedestrians: Array<{ mesh: THREE.Group; baseX: number; baseZ: number; speed: number; phase: number; direction: number }> = [];

  private readonly container: HTMLElement;
  private readonly player = new THREE.Group();
  private readonly vehicle = new THREE.Group();
  private readonly missionTarget = new THREE.Vector3(18, 0.5, 18);
  private readonly missionMarker: THREE.Mesh;

  private playerYaw = 0;
  private playerVelocityY = 0;
  private vehicleVelocity = 0;
  private vehicleYaw = 0;
  private touchStick = new THREE.Vector2();
  private isOnFoot = true;
  private jumpQueued = false;
  private interactQueued = false;
  private missionComplete = false;
  private cash = 250;
  private health = 100;

  private ui = {
    missionText: null as HTMLElement | null,
    modeText: null as HTMLElement | null,
    healthText: null as HTMLElement | null,
    cashText: null as HTMLElement | null,
    playerDot: null as SVGCircleElement | null,
    targetDot: null as SVGCircleElement | null,
    movePad: null as HTMLDivElement | null,
    moveStick: null as HTMLDivElement | null,
    jumpBtn: null as HTMLButtonElement | null,
    interactBtn: null as HTMLButtonElement | null,
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = `
      <div id="hud">
        <div id="hud-left">
          <div id="mission-card">
            <div id="mission-label">Mission</div>
            <div id="mission-text">Reach the glowing checkpoint on the east side of the city.</div>
          </div>
        </div>
        <div id="hud-right">
          <div id="status-card">
            <div class="stat-row"><span>Mode</span><span id="mode-text">On Foot</span></div>
            <div class="stat-row"><span>Health</span><span id="health-text">100%</span></div>
            <div class="stat-row"><span>Cash</span><span id="cash-text">$250</span></div>
          </div>
          <div id="minimap">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="minimap">
              <rect x="0" y="0" width="100" height="100" fill="rgba(9,19,25,0.8)" stroke="rgba(125,206,255,0.5)"/>
              <circle id="target-dot" cx="0" cy="0" r="4" fill="#7df9ff"/>
              <circle id="player-dot" cx="0" cy="0" r="3.5" fill="#5bd5ff"/>
            </svg>
          </div>
        </div>
      </div>
      <div id="touch-controls">
        <div id="move-pad" aria-label="Move pad">
          <div id="move-stick"></div>
        </div>
        <div id="actions">
          <button id="jump-btn" class="action-btn">Jump</button>
          <button id="interact-btn" class="action-btn">Enter</button>
        </div>
      </div>
    `;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(0, 6, 12);

    this.missionMarker = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.18, 14, 36),
      new THREE.MeshStandardMaterial({ color: 0x82f7ff, emissive: 0x41d0ff, emissiveIntensity: 0.9 })
    );
    this.missionMarker.rotation.x = Math.PI / 2;
    this.missionMarker.position.copy(this.missionTarget);
    this.missionMarker.position.y = 0.7;

    this.cacheUi();
    this.buildScene();
    this.buildPlayer();
    this.buildVehicle();
    this.buildTraffic();
    this.buildPedestrians();
    this.bindKeyboard();
    this.bindTouchControls();
    this.updateHud();
    this.renderer.setAnimationLoop(() => this.animate());
  }

  private cacheUi() {
    this.ui.missionText = document.getElementById('mission-text') as HTMLElement;
    this.ui.modeText = document.getElementById('mode-text') as HTMLElement;
    this.ui.healthText = document.getElementById('health-text') as HTMLElement;
    this.ui.cashText = document.getElementById('cash-text') as HTMLElement;
    this.ui.playerDot = document.getElementById('player-dot') as SVGCircleElement;
    this.ui.targetDot = document.getElementById('target-dot') as SVGCircleElement;
    this.ui.movePad = document.getElementById('move-pad') as HTMLDivElement;
    this.ui.moveStick = document.getElementById('move-stick') as HTMLDivElement;
    this.ui.jumpBtn = document.getElementById('jump-btn') as HTMLButtonElement;
    this.ui.interactBtn = document.getElementById('interact-btn') as HTMLButtonElement;
  }

  private buildScene() {
    this.scene.background = new THREE.Color(0x96c7ef);
    this.scene.fog = new THREE.Fog(0x96c7ef, 35, 130);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x233225, 1.3);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0c7, 1.4);
    sun.position.set(25, 40, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.left = -35;
    sun.shadow.camera.right = 35;
    sun.shadow.camera.top = 35;
    sun.shadow.camera.bottom = -35;
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({ color: 0x7fb56d, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const roadMat = new THREE.MeshStandardMaterial({ color: 0x2d3135, roughness: 0.95, metalness: 0.1 });
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x6e747b, roughness: 0.85 });

    const mainRoad = new THREE.Mesh(new THREE.BoxGeometry(70, 0.2, 12), roadMat);
    mainRoad.position.set(0, 0.1, 0);
    mainRoad.receiveShadow = true;
    this.scene.add(mainRoad);

    const crossRoad = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 70), roadMat);
    crossRoad.position.set(0, 0.1, 0);
    crossRoad.receiveShadow = true;
    this.scene.add(crossRoad);

    const sidewalk1 = new THREE.Mesh(new THREE.BoxGeometry(70, 0.18, 3), sidewalkMat);
    sidewalk1.position.set(0, 0.09, 7.5);
    this.scene.add(sidewalk1);

    const sidewalk2 = new THREE.Mesh(new THREE.BoxGeometry(70, 0.18, 3), sidewalkMat);
    sidewalk2.position.set(0, 0.09, -7.5);
    this.scene.add(sidewalk2);

    const sidewalk3 = new THREE.Mesh(new THREE.BoxGeometry(3, 0.18, 70), sidewalkMat);
    sidewalk3.position.set(7.5, 0.09, 0);
    this.scene.add(sidewalk3);

    const sidewalk4 = new THREE.Mesh(new THREE.BoxGeometry(3, 0.18, 70), sidewalkMat);
    sidewalk4.position.set(-7.5, 0.09, 0);
    this.scene.add(sidewalk4);

    this.buildBuilding(-18, -18, 8, 8, 10);
    this.buildBuilding(-18, 18, 8, 8, 10);
    this.buildBuilding(18, -18, 8, 8, 10);
    this.buildBuilding(18, 18, 8, 8, 10);
    this.buildBuilding(-5, -18, 8, 8, 9);
    this.buildBuilding(5, 18, 8, 8, 9);
    this.buildBuilding(-18, 5, 8, 8, 9);
    this.buildBuilding(18, -5, 8, 8, 9);

    for (let i = -28; i <= 28; i += 8) {
      this.addStreetlight(i, 12);
      this.addStreetlight(i, -12);
      this.addStreetlight(12, i);
      this.addStreetlight(-12, i);
    }

    this.scene.add(this.missionMarker);
  }

  private buildBuilding(x: number, z: number, w: number, d: number, h: number) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0xc5d0d8, roughness: 0.85, metalness: 0.2 })
    );
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    this.obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }

  private addStreetlight(x: number, z: number) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 4.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x586168, metalness: 0.7, roughness: 0.35 })
    );
    pole.position.set(x, 2.4, z);
    pole.castShadow = true;
    this.scene.add(pole);

    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.25, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xfff2bf, emissive: 0xffd775, emissiveIntensity: 0.8 })
    );
    lamp.position.set(x, 4.9, z);
    this.scene.add(lamp);
  }

  private buildPlayer() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4bb6ff, roughness: 0.8 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf3d9b7, roughness: 0.9 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 1.25, 5, 12), bodyMat);
    torso.position.y = 1.2;
    torso.castShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16), headMat);
    head.position.y = 2.25;
    head.castShadow = true;

    this.player.add(torso, head);
    this.player.position.set(0, 0, 10);
    this.player.rotation.y = Math.PI;
    this.scene.add(this.player);
  }

  private buildVehicle() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xee6a5a, roughness: 0.7, metalness: 0.2 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.6, metalness: 0.7 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x131313, roughness: 0.8 });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.7, 4.7), bodyMat);
    chassis.position.y = 1.25;
    chassis.castShadow = true;
    this.vehicle.add(chassis);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8, 2.2), trimMat);
    cabin.position.set(0, 2, 0.1);
    cabin.castShadow = true;
    this.vehicle.add(cabin);

    const wheelGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 16);
    const wheelPositions = [
      [-1.15, 0.5, 1.5],
      [1.15, 0.5, 1.5],
      [-1.15, 0.5, -1.5],
      [1.15, 0.5, -1.5],
    ] as const;

    wheelPositions.forEach(([x, y, z]) => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, y, z);
      wheel.castShadow = true;
      this.vehicle.add(wheel);
    });

    this.vehicle.position.set(0, 0, -14);
    this.vehicle.rotation.y = Math.PI;
    this.vehicle.visible = true;
    this.scene.add(this.vehicle);
  }

  private buildTraffic() {
    const carColors = [0xffaf45, 0x63c2ff, 0x7ce18d];

    carColors.forEach((color, index) => {
      const car = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.78, 3.1),
        new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
      );
      body.position.y = 0.8;
      body.castShadow = true;
      car.add(body);

      for (const [x, z] of [[-0.7, 1.05], [0.7, 1.05], [-0.7, -1.05], [0.7, -1.05]] as const) {
        const wheel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.26, 0.26, 0.28, 12),
          new THREE.MeshStandardMaterial({ color: 0x111111 })
        );
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.3, z);
        wheel.castShadow = true;
        car.add(wheel);
      }

      car.position.set(index % 2 === 0 ? -28 + index * 15 : 12, 0, index < 2 ? 0 : -20 + index * 7);
      this.scene.add(car);
      this.trafficCars.push({ mesh: car, axis: index % 2 === 0 ? 'x' : 'z', speed: 7 + index * 1.5 });
    });
  }

  private buildPedestrians() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0d5af, roughness: 1 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x2e6eea, roughness: 0.85 });

    const coords = [
      { x: -22, z: 9, speed: 1.2, phase: 0.5, direction: 1 },
      { x: 22, z: 9, speed: 1.3, phase: 1.8, direction: -1 },
      { x: -9, z: -22, speed: 1.6, phase: 3.1, direction: 1 },
      { x: 9, z: 22, speed: 1.4, phase: 5.2, direction: -1 },
      { x: -18, z: -9, speed: 1.1, phase: 2.4, direction: 1 },
    ];

    coords.forEach((entry) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 4, 8), shirt);
      body.position.y = 0.85;
      body.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), skin);
      head.position.y = 1.7;
      head.castShadow = true;
      group.add(body, head);
      group.position.set(entry.x, 0, entry.z);
      this.scene.add(group);
      this.pedestrians.push({ mesh: group, baseX: entry.x, baseZ: entry.z, speed: entry.speed, phase: entry.phase, direction: entry.direction });
    });
  }

  private bindKeyboard() {
    window.addEventListener('keydown', (event) => {
      this.keyboard.add(event.code);
      if (event.code === 'Space' || event.code === 'KeyJ') this.jumpQueued = true;
      if (event.code === 'KeyE' || event.code === 'Enter') this.interactQueued = true;
    });

    window.addEventListener('keyup', (event) => {
      this.keyboard.delete(event.code);
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private bindTouchControls() {
    if (!this.ui.movePad || !this.ui.moveStick || !this.ui.jumpBtn || !this.ui.interactBtn) {
      return;
    }

    let pointerId: number | null = null;

    const clampPad = (event: PointerEvent) => {
      const rect = this.ui.movePad!.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const localX = event.clientX - centerX;
      const localY = event.clientY - centerY;
      const max = rect.width * 0.3;
      const length = Math.min(Math.hypot(localX, localY), max);
      const angle = Math.atan2(localY, localX);
      const x = Math.cos(angle) * length;
      const y = Math.sin(angle) * length;
      this.ui.moveStick!.style.transform = `translate(${x}px, ${y}px)`;
      this.touchStick.set(x / max, y / max);
    };

    const resetStick = () => {
      this.touchStick.set(0, 0);
      this.ui.moveStick!.style.transform = 'translate(0px, 0px)';
    };

    this.ui.movePad.addEventListener('pointerdown', (event) => {
      pointerId = event.pointerId;
      this.ui.movePad!.setPointerCapture(pointerId);
      clampPad(event);
    });

    this.ui.movePad.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      clampPad(event);
    });

    this.ui.movePad.addEventListener('pointerup', resetStick);
    this.ui.movePad.addEventListener('pointercancel', resetStick);
    this.ui.movePad.addEventListener('pointerleave', resetStick);

    this.ui.jumpBtn.addEventListener('pointerdown', () => {
      this.jumpQueued = true;
    });

    this.ui.interactBtn.addEventListener('pointerdown', () => {
      this.interactQueued = true;
    });
  }

  private getMoveInput() {
    let x = 0;
    let y = 0;

    if (this.keyboard.has('KeyA') || this.keyboard.has('ArrowLeft')) x -= 1;
    if (this.keyboard.has('KeyD') || this.keyboard.has('ArrowRight')) x += 1;
    if (this.keyboard.has('KeyW') || this.keyboard.has('ArrowUp')) y += 1;
    if (this.keyboard.has('KeyS') || this.keyboard.has('ArrowDown')) y -= 1;

    x += this.touchStick.x;
    y += this.touchStick.y;

    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }

    return { x, y };
  }

  private handleInput() {
    if (this.interactQueued) {
      this.toggleVehicle();
      this.interactQueued = false;
    }

    if (this.jumpQueued) {
      if (this.isOnFoot && this.player.position.y < 0.1) {
        this.playerVelocityY = 8.2;
      }
      this.jumpQueued = false;
    }
  }

  private toggleVehicle() {
    if (this.isOnFoot) {
      const distance = this.player.position.distanceTo(this.vehicle.position);
      if (distance < 3.5) {
        this.isOnFoot = false;
        this.player.visible = false;
        this.vehicle.visible = true;
        this.vehicle.position.copy(this.player.position.clone().setY(0));
        this.vehicleYaw = this.playerYaw;
        this.vehicle.rotation.y = this.vehicleYaw;
      }
    } else {
      this.isOnFoot = true;
      this.player.visible = true;
      const exitOffset = new THREE.Vector3(Math.sin(this.vehicleYaw) * 2.8, 0, Math.cos(this.vehicleYaw) * 2.8);
      this.player.position.copy(this.vehicle.position).add(exitOffset);
      this.player.position.y = 0;
      this.playerYaw = this.vehicleYaw;
      this.player.rotation.y = this.playerYaw;
      this.vehicle.visible = true;
    }
  }

  private updatePlayer(dt: number) {
    const input = this.getMoveInput();
    const run = this.keyboard.has('ShiftLeft') || this.keyboard.has('ShiftRight');
    const moveSpeed = run ? 9.5 : 6.5;

    if (Math.abs(input.x) > 0.05 || Math.abs(input.y) > 0.05) {
      const dir = Math.atan2(input.x, input.y);
      this.playerYaw = dir;
      this.player.rotation.y = dir;
      const forward = new THREE.Vector3(Math.sin(dir), 0, Math.cos(dir));
      const next = this.player.position.clone().addScaledVector(forward, moveSpeed * dt);
      this.player.position.copy(this.resolveCollisions(next, 0.9));
    }

    this.player.position.y += this.playerVelocityY * dt;
    this.playerVelocityY -= 16 * dt;
    if (this.player.position.y <= 0) {
      this.player.position.y = 0;
      this.playerVelocityY = 0;
    }
  }

  private updateVehicle(dt: number) {
    const input = this.getMoveInput();
    const throttle = input.y;
    const steer = input.x;
    const acceleration = 23;
    const drag = 0.92;
    const maxSpeed = 22;

    if (Math.abs(throttle) > 0.03) {
      this.vehicleVelocity += throttle * acceleration * dt;
    }

    this.vehicleVelocity *= drag;
    this.vehicleVelocity = THREE.MathUtils.clamp(this.vehicleVelocity, -maxSpeed, maxSpeed);
    if (Math.abs(this.vehicleVelocity) < 0.02) this.vehicleVelocity = 0;

    const steeringFactor = Math.min(Math.abs(this.vehicleVelocity) / 12 + 0.4, 1.8);
    this.vehicleYaw += steer * steeringFactor * dt * (Math.abs(this.vehicleVelocity) * 0.1 + 0.7);

    const forward = new THREE.Vector3(Math.sin(this.vehicleYaw), 0, Math.cos(this.vehicleYaw));
    const next = this.vehicle.position.clone().addScaledVector(forward, this.vehicleVelocity * dt);
    this.vehicle.position.copy(this.resolveCollisions(next, 2.1));
    this.vehicle.rotation.y = this.vehicleYaw;
  }

  private resolveCollisions(position: THREE.Vector3, radius: number) {
    const result = position.clone();

    for (const obstacle of this.obstacles) {
      const centerX = (obstacle.minX + obstacle.maxX) / 2;
      const centerZ = (obstacle.minZ + obstacle.maxZ) / 2;
      const halfX = (obstacle.maxX - obstacle.minX) / 2 + radius;
      const halfZ = (obstacle.maxZ - obstacle.minZ) / 2 + radius;
      const dx = result.x - centerX;
      const dz = result.z - centerZ;
      const overlapX = halfX - Math.abs(dx);
      const overlapZ = halfZ - Math.abs(dz);

      if (overlapX > 0 && overlapZ > 0) {
        if (overlapX < overlapZ) {
          result.x += Math.sign(dx || 1) * overlapX;
        } else {
          result.z += Math.sign(dz || 1) * overlapZ;
        }
      }
    }

    result.x = THREE.MathUtils.clamp(result.x, -31, 31);
    result.z = THREE.MathUtils.clamp(result.z, -31, 31);
    return result;
  }

  private updateTraffic(dt: number) {
    for (const car of this.trafficCars) {
      if (car.axis === 'x') {
        car.mesh.position.x += car.speed * dt;
        if (car.mesh.position.x > 32) car.mesh.position.x = -32;
      } else {
        car.mesh.position.z += car.speed * dt;
        if (car.mesh.position.z > 32) car.mesh.position.z = -32;
      }
    }
  }

  private updatePedestrians() {
    const time = this.clock.elapsedTime;
    for (const person of this.pedestrians) {
      const sway = Math.sin(time * person.speed + person.phase) * 3.5;
      if (Math.abs(person.baseZ) > 15) {
        person.mesh.position.x = person.baseX + sway * person.direction;
        person.mesh.position.z = person.baseZ;
      } else {
        person.mesh.position.x = person.baseX;
        person.mesh.position.z = person.baseZ + sway * person.direction;
      }
    }
  }

  private updateMission() {
    if (this.missionComplete) return;

    const activeTarget = this.isOnFoot ? this.player.position : this.vehicle.position;
    const distance = activeTarget.distanceTo(this.missionTarget);
    if (distance < 3.2) {
      this.missionComplete = true;
      this.cash += 1000;
      if (this.ui.missionText) this.ui.missionText.textContent = 'Mission complete — reward collected!';
    }
  }

  private updateCamera() {
    if (this.isOnFoot) {
      const desired = this.player.position.clone().add(new THREE.Vector3(Math.sin(this.playerYaw + Math.PI) * 6, 4.4, Math.cos(this.playerYaw + Math.PI) * 6));
      this.camera.position.lerp(desired, 0.12);
      this.camera.lookAt(this.player.position.x, this.player.position.y + 1.5, this.player.position.z);
      return;
    }

    const desired = this.vehicle.position.clone().add(new THREE.Vector3(Math.sin(this.vehicleYaw + Math.PI) * 7.2, 4.8, Math.cos(this.vehicleYaw + Math.PI) * 7.2));
    this.camera.position.lerp(desired, 0.12);
    this.camera.lookAt(this.vehicle.position.x, this.vehicle.position.y + 1.5, this.vehicle.position.z);
  }

  private updateHud() {
    if (this.ui.modeText) this.ui.modeText.textContent = this.isOnFoot ? 'On Foot' : 'Driving';
    if (this.ui.healthText) this.ui.healthText.textContent = `${Math.round(this.health)}%`;
    if (this.ui.cashText) this.ui.cashText.textContent = `$${this.cash}`;

    if (this.ui.playerDot) {
      const px = ((this.player.position.x + 30) / 60) * 100;
      const py = ((this.player.position.z + 30) / 60) * 100;
      this.ui.playerDot.setAttribute('cx', px.toFixed(2));
      this.ui.playerDot.setAttribute('cy', py.toFixed(2));
    }

    if (this.ui.targetDot) {
      const tx = ((this.missionTarget.x + 30) / 60) * 100;
      const ty = ((this.missionTarget.z + 30) / 60) * 100;
      this.ui.targetDot.setAttribute('cx', tx.toFixed(2));
      this.ui.targetDot.setAttribute('cy', ty.toFixed(2));
    }
  }

  private animate = () => {
    const dt = Math.min(this.clock.getDelta(), 0.033);

    this.handleInput();

    if (this.isOnFoot) {
      this.updatePlayer(dt);
      this.player.visible = true;
    } else {
      this.updateVehicle(dt);
      this.player.visible = false;
    }

    this.updateTraffic(dt);
    this.updatePedestrians();
    this.missionMarker.rotation.z += 0.03;
    this.updateMission();
    this.updateCamera();
    this.updateHud();

    this.renderer.render(this.scene, this.camera);
  };
}
