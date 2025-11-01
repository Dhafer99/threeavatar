import { Component, AfterViewInit, ElementRef, ViewChild, HostListener } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

@Component({
  selector: 'app-three-scene',
  templateUrl: './three-scene.html',
  styleUrls: ['./three-scene.scss'],
})
export class ThreeScene implements AfterViewInit {
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private clock = new THREE.Clock();

  private avatar!: THREE.Group;
  private mixer!: THREE.AnimationMixer;
  private actions: { [key: string]: THREE.AnimationAction } = {};
  private currentAction: THREE.AnimationAction | null = null;

  private keys: { [key: string]: boolean } = {};
  private moveSpeed = 2;
  private sprintSpeed = 4;
  private animationStates = { 
    idle: 'idle', 
    forward: 'wlking', 
    backward: 'walkingbackward',
    running: 'running',
    holdingball: 'holdingball',
    standingtocrouched: 'standingtocrouched',
    throwball: 'throwball'
  };
  private currentState = this.animationStates.idle;
  
  // Basketball game state
  private hasBall = false;
  private isCrouched = false;
  private isTransitioning = false;
  private isThrowingBall = false;
  private ballWasThrown = false; // Track if ball was recently thrown
  
  // Basketball physics
  private basketball!: THREE.Group;
  private basketballVelocity = new THREE.Vector3(0, 0, 0);
  private gravity = -9.81;
  private bounceReduction = 0.7;
  private groundY = -1.5;
  private basketballRadius = 0.12;
  private pickupDistance = 1.5;
  
  // Basketball court and collision
  private basketballCourt!: THREE.Group;
  private collisionBoxes: THREE.Box3[] = [];
  private collisionObjectNames: string[] = [];

  // Camera controls
  private cameraDistance = 4;
  private cameraHeight = 1.8;
  private cameraAngle = 0;
  private cameraVerticalAngle = 0;
  private isMouseDown = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  ngAfterViewInit(): void {
    this.initThreeJS();
    this.loadGLBModel('assets/boy.glb');
    this.loadBasketball('assets/basketball.glb');
    this.loadBasketballCourt('assets/basketball_court.glb');
    this.animate();
  }

  private initThreeJS(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 1.8, 4);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas.nativeElement, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0xf0f0f0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.5;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Add game instructions to the page
    this.createGameInstructions();

    // Handle resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Mouse controls for camera
    this.canvas.nativeElement.addEventListener('mousedown', (event) => {
      this.isMouseDown = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    });

    window.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

    window.addEventListener('mousemove', (event) => {
      if (this.isMouseDown) {
        const deltaX = event.clientX - this.lastMouseX;
        const deltaY = event.clientY - this.lastMouseY;
        
        // Reversed horizontal mouse direction for more intuitive controls
        this.cameraAngle -= deltaX * 0.01;
        this.cameraVerticalAngle += deltaY * 0.01;
        
        // Limit vertical angle
        this.cameraVerticalAngle = Math.max(-Math.PI/3, Math.min(Math.PI/3, this.cameraVerticalAngle));
        
        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;
      }
    });

    // Mouse wheel for zoom
    this.canvas.nativeElement.addEventListener('wheel', (event) => {
      this.cameraDistance += event.deltaY * 0.01;
      this.cameraDistance = Math.max(1, Math.min(10, this.cameraDistance));
    });
  }

  private loadGLBModel(url: string): void {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        this.avatar = gltf.scene;
        this.avatar.position.set(0, -1.5, 0);
        this.avatar.scale.set(1, 1, 1); // GLB usually doesn't need scaling
        this.avatar.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
        this.scene.add(this.avatar);

        // Animation mixer
        this.mixer = new THREE.AnimationMixer(this.avatar);

        // Setup animations
        if (gltf.animations && gltf.animations.length > 0) {
          gltf.animations.forEach((clip: THREE.AnimationClip) => {
            const name = clip.name.toLowerCase();
            
            // Remove position tracks to make animations in-place
            const filteredTracks = clip.tracks.filter(track => {
              return !track.name.includes('.position');
            });
            
            const inPlaceClip = new THREE.AnimationClip(clip.name, clip.duration, filteredTracks);
            
            if (name.includes('idle')) this.actions['idle'] = this.mixer.clipAction(inPlaceClip);
            if (name.includes('walkingbackward')) this.actions['walkingbackward'] = this.mixer.clipAction(inPlaceClip);
            if (name.includes('wlking')) this.actions['wlking'] = this.mixer.clipAction(inPlaceClip);
            if (name.includes('running')) this.actions['running'] = this.mixer.clipAction(inPlaceClip);
            if (name.includes('holdingball')) this.actions['holdingball'] = this.mixer.clipAction(inPlaceClip);
            if (name.includes('standingtocrouched')) {
              this.actions['standingtocrouched'] = this.mixer.clipAction(inPlaceClip);
              this.actions['standingtocrouched'].setLoop(THREE.LoopOnce, 1);
              this.actions['standingtocrouched'].clampWhenFinished = true;
            }
            if (name.includes('throwball')) {
              this.actions['throwball'] = this.mixer.clipAction(inPlaceClip);
              this.actions['throwball'].setLoop(THREE.LoopOnce, 1);
              this.actions['throwball'].clampWhenFinished = true;
            }
          });
          this.playAnimation(this.animationStates.idle);
        }
      },
      undefined,
      err => console.error('Error loading GLB:', err)
    );
  }

  private loadBasketball(url: string): void {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        this.basketball = gltf.scene;
        this.basketball.position.set(3, -1.2, 0); // Start position on ground
        this.basketball.scale.set(0.15, 0.15, 0.15); // Much smaller basketball size
        this.basketball.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
        this.scene.add(this.basketball);
      },
      undefined,
      err => console.error('Error loading basketball:', err)
    );
  }

  private loadBasketballCourt(url: string): void {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        this.basketballCourt = gltf.scene;
        this.basketballCourt.position.set(0, -2.1, 0); // Position at ground level
        this.basketballCourt.scale.set(4, 3, 3); // Your adjusted scale
        this.basketballCourt.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
        this.scene.add(this.basketballCourt);
        
        // Create collision boxes after loading
        this.createCourtCollisions();
        console.log('Basketball court loaded successfully');
      },
      undefined,
      err => console.error('Error loading basketball court:', err)
    );
  }

  private createCourtCollisions(): void {
    if (!this.basketballCourt) return;

    this.collisionBoxes = [];
    
    this.basketballCourt.traverse(child => {
      const name = child.name;
      
      // Create collision for Object_7, Object_21, Object_22, and Object_28
      if (name === 'Object_7' ) {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          
          // Calculate bounding box and apply court scaling manually
          const localBox = new THREE.Box3().setFromObject(mesh);
          
          // Apply the basketball court's scale (4, 3, 3) and position to match visual appearance
          const courtScale = this.basketballCourt.scale;
          const courtPos = this.basketballCourt.position;
          
          const scaledMin = new THREE.Vector3(
            localBox.min.x * courtScale.x + courtPos.x,
            localBox.min.y * courtScale.y + courtPos.y,
            localBox.min.z * courtScale.z + courtPos.z
          );
          const scaledMax = new THREE.Vector3(
            localBox.max.x * courtScale.x + courtPos.x,
            localBox.max.y * courtScale.y + courtPos.y,
            localBox.max.z * courtScale.z + courtPos.z
          );
          
          const worldBox = new THREE.Box3(scaledMin, scaledMax);
          
          // Special scaling for Object_7 - make it taller
          if (child.name === 'Object_7') {
            const heightIncrease = 2.0; // Make it 2 units taller
            worldBox.max.y += heightIncrease;
          }
          
          const height = worldBox.max.y - worldBox.min.y;
          const width = worldBox.max.x - worldBox.min.x;
          const depth = worldBox.max.z - worldBox.min.z;
          
          // Assign different colors for each object
          const colors = [
            0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff,
            0xff8000, 0x8000ff, 0x00ff80, 0xff0080, 0x8080ff, 0xff8080,
            0x80ff00, 0x0080ff, 0x80ff80, 0xffffff, 0x808080, 0x400040,
            0x004000, 0x400000, 0x000040, 0x404040, 0x800080, 0x008080,
            0x808000, 0xff4040, 0x40ff40, 0x4040ff, 0xffff40, 0xff40ff,
            0x40ffff, 0x404000, 0x004040, 0x400000
          ];
          const colorNames = [
            'RED', 'GREEN', 'BLUE', 'YELLOW', 'MAGENTA', 'CYAN',
            'ORANGE', 'PURPLE', 'LIME', 'PINK', 'LIGHT_BLUE', 'LIGHT_RED',
            'LIGHT_GREEN', 'DARK_BLUE', 'LIGHT_GRAY', 'WHITE', 'GRAY', 'DARK_PURPLE',
            'DARK_GREEN', 'DARK_RED', 'NAVY', 'DARK_GRAY', 'VIOLET', 'TEAL',
            'OLIVE', 'CORAL', 'MINT', 'PERIWINKLE', 'GOLD', 'FUCHSIA',
            'AQUA', 'BROWN', 'SLATE', 'MAROON'
          ];
          const colorIndex = this.collisionBoxes.length % colors.length;
          
          console.log(`Added collision for: ${child.name} - COLOR: ${colorNames[colorIndex]}`, 
            `Min: (${worldBox.min.x.toFixed(2)}, ${worldBox.min.y.toFixed(2)}, ${worldBox.min.z.toFixed(2)})`,
            `Max: (${worldBox.max.x.toFixed(2)}, ${worldBox.max.y.toFixed(2)}, ${worldBox.max.z.toFixed(2)})`,
            `Size: ${width.toFixed(2)}×${height.toFixed(2)}×${depth.toFixed(2)}`);
          
          this.collisionBoxes.push(worldBox);
          this.collisionObjectNames.push(child.name);
        }
      }
    });
    
    console.log(`Created ${this.collisionBoxes.length} collision boxes`);
    
    // Dynamic color legend showing actual objects found
    console.log('=== COLLISION BOX COLOR LEGEND ===');
    const colorNames = [
      'RED', 'GREEN', 'BLUE', 'YELLOW', 'MAGENTA', 'CYAN',
      'ORANGE', 'PURPLE', 'LIME', 'PINK', 'LIGHT_BLUE', 'LIGHT_RED',
      'LIGHT_GREEN', 'DARK_BLUE', 'LIGHT_GRAY', 'WHITE', 'GRAY', 'DARK_PURPLE',
      'DARK_GREEN', 'DARK_RED', 'NAVY', 'DARK_GRAY', 'VIOLET', 'TEAL',
      'OLIVE', 'CORAL', 'MINT', 'PERIWINKLE', 'GOLD', 'FUCHSIA',
      'AQUA', 'BROWN', 'SLATE', 'MAROON'
    ];
    this.collisionObjectNames.forEach((objectName, index) => {
      const colorName = colorNames[index % colorNames.length];
      console.log(`${colorName} = ${objectName}`);
    });
    console.log('=====================================');
    
    // Debug: Show all collision box positions with sizes
    this.collisionBoxes.forEach((box, index) => {
      const width = box.max.x - box.min.x;
      const height = box.max.y - box.min.y;
      const depth = box.max.z - box.min.z;
      console.log(`Box ${index}: Min(${box.min.x.toFixed(2)}, ${box.min.y.toFixed(2)}, ${box.min.z.toFixed(2)}) Max(${box.max.x.toFixed(2)}, ${box.max.y.toFixed(2)}, ${box.max.z.toFixed(2)}) Size: ${width.toFixed(2)}×${height.toFixed(2)}×${depth.toFixed(2)}`);
    });
  }

  private checkCollision(newPosition: THREE.Vector3): boolean {
    if (this.collisionBoxes.length === 0) {
      console.log('No collision boxes available');
      return false;
    }

    // Create a small sphere around the character
    const characterRadius = 0.2;
    const characterCenter = new THREE.Vector3(newPosition.x, newPosition.y + 0.5, newPosition.z);

    // Debug: Show character position occasionally
    if (Math.random() < 0.01) {
      console.log(`Character at: (${newPosition.x.toFixed(2)}, ${newPosition.z.toFixed(2)})`);
    }

    // Check collision with all court objects (surface-based collision)
    for (let i = 0; i < this.collisionBoxes.length; i++) {
      const collisionBox = this.collisionBoxes[i];
      
      // Check if character sphere intersects with the collision box boundaries
      // Expand the collision box slightly outward to create surface collision
      const expandedBox = collisionBox.clone();
      expandedBox.expandByScalar(characterRadius);
      
      // If character center is inside the expanded box, they're hitting the surface
      if (expandedBox.containsPoint(characterCenter)) {
        // But make sure they're not completely inside the original box
        if (!collisionBox.containsPoint(characterCenter)) {
          console.log(`Surface collision detected with box ${i}`);
          console.log(`Character: (${newPosition.x.toFixed(2)}, ${newPosition.z.toFixed(2)})`);
          return true; // Surface collision detected
        }
      }
    }

    return false; // No collision
  }

  private checkBasketballCollision(newPosition: THREE.Vector3): { hasCollision: boolean, hitFace?: string } {
    if (this.collisionBoxes.length === 0) {
      console.log('⚠️ No collision boxes available for basketball collision detection!');
      return { hasCollision: false };
    }

    // Create a sphere around the basketball
    const ballRadius = this.basketballRadius;
    const ballCenter = newPosition.clone();
    const currentBallCenter = this.basketball.position.clone();

    // Check collision with all court objects
    for (let i = 0; i < this.collisionBoxes.length; i++) {
      const collisionBox = this.collisionBoxes[i];
      
      // Check if basketball sphere intersects with collision box
      const expandedBox = collisionBox.clone();
      expandedBox.expandByScalar(ballRadius);
      
      // Check if ball center is inside the expanded box (collision detected)
      if (expandedBox.containsPoint(ballCenter)) {
        // But not if it's completely inside the original box (avoid internal collision)
        if (!collisionBox.containsPoint(ballCenter)) {
          // Determine which face was hit by checking which direction the ball came from
          let hitFace = 'unknown';
          
          // Calculate penetration depth on each axis
          const penetrationX = Math.min(
            ballCenter.x - expandedBox.min.x,  // Left penetration
            expandedBox.max.x - ballCenter.x   // Right penetration
          );
          const penetrationY = Math.min(
            ballCenter.y - expandedBox.min.y,  // Bottom penetration
            expandedBox.max.y - ballCenter.y   // Top penetration
          );
          const penetrationZ = Math.min(
            ballCenter.z - expandedBox.min.z,  // Back penetration
            expandedBox.max.z - ballCenter.z   // Front penetration
          );
          
          // The axis with minimum penetration indicates the collision face
          if (penetrationX <= penetrationY && penetrationX <= penetrationZ) {
            // X-axis collision (left/right face)
            if (ballCenter.x < collisionBox.getCenter(new THREE.Vector3()).x) {
              hitFace = 'left';
            } else {
              hitFace = 'right';
            }
          } else if (penetrationY <= penetrationZ) {
            // Y-axis collision (top/bottom face)
            if (ballCenter.y < collisionBox.getCenter(new THREE.Vector3()).y) {
              hitFace = 'bottom';
            } else {
              hitFace = 'top';
            }
          } else {
            // Z-axis collision (front/back face)
            if (ballCenter.z < collisionBox.getCenter(new THREE.Vector3()).z) {
              hitFace = 'back';
            } else {
              hitFace = 'front';
            }
          }
          
          // For Object_28, only allow front and back face collisions (vertical surfaces on higher end)
          if (this.collisionObjectNames[i] === 'Object_28') {
            if (hitFace !== 'front' && hitFace !== 'back') {
              // Skip collision for other faces of Object_28 (only allow front/back)
              continue;
            }
          }
          
          console.log(`Basketball collision detected with object ${this.collisionObjectNames[i]} on ${hitFace} face`);
          console.log('Penetrations - X:', penetrationX.toFixed(3), 'Y:', penetrationY.toFixed(3), 'Z:', penetrationZ.toFixed(3));
          
          return { hasCollision: true, hitFace: hitFace };
        }
      }
    }

    return { hasCollision: false }; // No collision
  }

  private playAnimation(state: string): void {
    if (!this.actions[state]) return;
    if (this.currentAction && this.currentAction !== this.actions[state]) {
      this.currentAction.fadeOut(0.3);
    }
    this.currentAction = this.actions[state];
    this.currentAction.reset().fadeIn(0.3).play();
    
    // Handle transition animations
    if (state === 'standingtocrouched') {
      this.isTransitioning = true;
      this.mixer.addEventListener('finished', this.onCrouchFinished.bind(this));
    } else if (state === 'throwball') {
      this.isTransitioning = true;
      this.isThrowingBall = true;
      this.mixer.addEventListener('finished', this.onThrowFinished.bind(this));
    }
  }

  private onCrouchFinished(): void {
    this.mixer.removeEventListener('finished', this.onCrouchFinished.bind(this));
    this.isCrouched = true;
    this.hasBall = true;
    this.isTransitioning = false;
    this.ballWasThrown = false; // Reset thrown flag when ball is picked up
    this.attachBasketballToHand();
    this.playAnimation(this.animationStates.holdingball);
    this.currentState = this.animationStates.holdingball;
    
    console.log('===== BALL PICKUP COMPLETED =====');
    console.log('Has ball:', this.hasBall);
    console.log('Ball was thrown flag reset to:', this.ballWasThrown);
    console.log('=================================');
  }

  private onThrowFinished(): void {
    this.mixer.removeEventListener('finished', this.onThrowFinished.bind(this));
    this.isCrouched = false;
    this.isTransitioning = false;
    this.isThrowingBall = false;
    // Ensure ball is definitely released
    this.hasBall = false;
    console.log('===== THROW ANIMATION FINISHED =====');
    console.log('Has ball after animation:', this.hasBall);
    console.log('Is throwing ball:', this.isThrowingBall);
    console.log('Ball position:', this.basketball.position);
    console.log('====================================');
    // Ball should already be thrown by now (at 80% of animation)
    this.playAnimation(this.animationStates.idle);
    this.currentState = this.animationStates.idle;
  }

  private updateBasketballPhysics(delta: number): void {
    if (!this.basketball) return;

    if (this.hasBall) {
      // Ball is held by character - update position to follow character's hand
      this.updateBasketballInHand();
      return;
    }

    // Safety check: If ball falls too far below ground, reset it
    if (this.basketball.position.y < -10) {
      console.log('⚠️ BASKETBALL FELL THROUGH WORLD - RESETTING');
      this.basketball.position.set(3, -1.2, 0); // Reset to initial position
      this.basketballVelocity.set(0, 0, 0); // Stop all movement
      this.hasBall = false; // Ensure ball is not considered held
      this.isThrowingBall = false; // Reset throwing state
      this.ballWasThrown = false; // Reset thrown flag
      return;
    }

    // Safety check: If ball goes too far away, reset it
    const distanceFromOrigin = this.basketball.position.length();
    if (distanceFromOrigin > 50) {
      console.log('⚠️ BASKETBALL TOO FAR AWAY - RESETTING');
      this.basketball.position.set(3, -1.2, 0); // Reset to initial position
      this.basketballVelocity.set(0, 0, 0); // Stop all movement
      this.hasBall = false; // Ensure ball is not considered held
      this.isThrowingBall = false; // Reset throwing state
      this.ballWasThrown = false; // Reset thrown flag
      return;
    }

    // Debug: Occasionally log that physics is running
    if (Math.random() < 0.01) {
      console.log('Basketball physics running - position:', this.basketball.position, 'velocity:', this.basketballVelocity);
    }

    // Apply gravity
    this.basketballVelocity.y += this.gravity * delta;

    // Calculate new position
    const newPosition = this.basketball.position.clone().add(
      new THREE.Vector3(
        this.basketballVelocity.x * delta,
        this.basketballVelocity.y * delta,
        this.basketballVelocity.z * delta
      )
    );

    // Check collision with court objects
    const collisionInfo = this.checkBasketballCollision(newPosition);
    if (collisionInfo.hasCollision) {
      console.log(`🏀 Basketball collision detected - bouncing off ${collisionInfo.hitFace} face`);
      console.log('Ball current pos:', this.basketball.position);
      console.log('Ball new pos (blocked):', newPosition);
      console.log('Ball velocity before bounce:', this.basketballVelocity);
      
      // Apply bounce based on which face was hit
      const bounceStrength = 0.8; // How much velocity to preserve after bounce
      
      if (collisionInfo.hitFace === 'top') {
        this.basketballVelocity.y = -Math.abs(this.basketballVelocity.y) * bounceStrength; // Force downward
        this.basketball.position.y = this.basketball.position.y; // Don't update Y position
      } else if (collisionInfo.hitFace === 'bottom') {
        this.basketballVelocity.y = Math.abs(this.basketballVelocity.y) * bounceStrength; // Force upward
        this.basketball.position.y = this.basketball.position.y; // Don't update Y position
      } else if (collisionInfo.hitFace === 'left') {
        this.basketballVelocity.x = Math.abs(this.basketballVelocity.x) * bounceStrength; // Force rightward
        this.basketball.position.x = this.basketball.position.x; // Don't update X position
      } else if (collisionInfo.hitFace === 'right') {
        this.basketballVelocity.x = -Math.abs(this.basketballVelocity.x) * bounceStrength; // Force leftward
        this.basketball.position.x = this.basketball.position.x; // Don't update X position
      } else if (collisionInfo.hitFace === 'front') {
        this.basketballVelocity.z = -Math.abs(this.basketballVelocity.z) * bounceStrength; // Force backward
        this.basketball.position.z = this.basketball.position.z; // Don't update Z position
      } else if (collisionInfo.hitFace === 'back') {
        this.basketballVelocity.z = Math.abs(this.basketballVelocity.z) * bounceStrength; // Force forward
        this.basketball.position.z = this.basketball.position.z; // Don't update Z position
      }
      
      // Reduce overall energy slightly
      this.basketballVelocity.multiplyScalar(0.9);
      
      console.log(`Basketball velocity after bounce:`, this.basketballVelocity);
    } else {
      // No collision, update position normally
      this.basketball.position.copy(newPosition);
    }

    // Ground collision
    if (this.basketball.position.y <= this.groundY + this.basketballRadius) {
      this.basketball.position.y = this.groundY + this.basketballRadius;
      
      // Bounce with energy loss
      if (Math.abs(this.basketballVelocity.y) > 0.1) {
        this.basketballVelocity.y = -this.basketballVelocity.y * this.bounceReduction;
      } else {
        this.basketballVelocity.y = 0;
      }
      
      // Apply friction to horizontal movement
      this.basketballVelocity.x *= 0.8;
      this.basketballVelocity.z *= 0.8;
    }

    // Check if ball can be picked up
    if (this.avatar && this.canPickupBall()) {
      // Visual feedback could be added here (glow, outline, etc.)
    }
  }

  private attachBasketballToHand(): void {
    if (!this.basketball || !this.avatar) return;
    this.basketball.visible = true;
    this.updateBasketballInHand();
  }

  private updateBasketballInHand(): void {
    if (!this.basketball || !this.avatar || !this.hasBall) {
      // Debug: Log when this method is called but conditions aren't met
      if (!this.hasBall && Math.random() < 0.1) {
        console.log('⚠️ updateBasketballInHand called but hasBall is false');
        console.log('Current states - hasBall:', this.hasBall, 'isThrowingBall:', this.isThrowingBall, 'isTransitioning:', this.isTransitioning);
      }
      return;
    }

    // Extra safety: Don't update if ball was thrown (even if states get confused)
    if (this.ballWasThrown) {
      console.log('⚠️ Ball was thrown - preventing hand update');
      console.log('Ball velocity:', this.basketballVelocity);
      this.hasBall = false; // Force ball to be released
      return;
    }

    // Extra safety: Don't update if ball has been thrown and animation is finishing
    if (!this.isThrowingBall && this.basketballVelocity.length() > 0.1) {
      console.log('⚠️ Ball has velocity but not throwing - preventing hand update');
      console.log('Ball velocity:', this.basketballVelocity);
      return;
    }
    
    // Base position relative to character's hands
    let handOffset = new THREE.Vector3(0, 1, 0.4); // Your adjusted values
    
    // If throwing, animate ball following the throw motion: down -> up -> throw
    if (this.isThrowingBall && this.currentAction) {
      // Get animation progress (0 to 1)
      const animationTime = this.currentAction.time;
      const animationDuration = this.currentAction.getClip().duration;
      const progress = Math.min(animationTime / animationDuration, 1);
      
      // Three-phase throwing motion
      if (progress <= 0.3) {
        // First 30%: Ball goes down (wind-up)
        const downProgress = progress / 0.3;
        const downCurve = Math.sin(downProgress * Math.PI * 0.5);
        handOffset.y -= downCurve * 0.2; // Go down less (0.2 units)
        handOffset.z -= downCurve * 0.1; // Pull back slightly
      } else if (progress <= 0.55) {
        // Next 25% (30-55%): Very fast upward motion
        const upProgress = (progress - 0.3) / 0.25;
        const upCurve = Math.pow(upProgress, 0.3); // Fast acceleration curve
        handOffset.y += (-0.2) + (upCurve * 0.9); // Quick upward movement
        handOffset.z += (-0.1) + (upCurve * 0.15); // Quick forward movement
      } else if (progress <= 0.6) {
        // 55-80%: Move ball behind character for throw
        const throwProgress = (progress - 0.55) / 0.25;
        handOffset.y += 0.7; // Hold at throwing height
        handOffset.z += 0.05 - (throwProgress * 0.3); // Move ball behind character
      } else {
        // 80-100%: Ball has been thrown, hide it
        if (this.hasBall) {
          console.log('🚀 Releasing ball at 80% of throw animation');
          this.hasBall = false;
          this.throwBasketball(); // Throw ball immediately at 80%
        }
        // Ball is no longer in hand, don't update position
        return;
      }
    }
    
    // Rotate offset based on character's rotation
    handOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.avatar.rotation.y);
    
    // Set ball position
    this.basketball.position.copy(this.avatar.position);
    this.basketball.position.add(handOffset);
  }

  private canPickupBall(): boolean {
    if (!this.basketball || !this.avatar || this.hasBall) return false;
    
    const distance = this.avatar.position.distanceTo(this.basketball.position);
    return distance <= this.pickupDistance;
  }

  private throwBasketball(): void {
    if (!this.basketball || !this.avatar) return;

    // Get throw direction
    const throwDirection = new THREE.Vector3(
      Math.sin(this.avatar.rotation.y),
      0,
      Math.cos(this.avatar.rotation.y)
    );
    
    // Ball starts from current position (already positioned from animation)
    // No need to reposition - use current ball position from animation
    this.basketball.visible = true;

    // Set throw velocity immediately
    const throwForce = 8;
    this.basketballVelocity.copy(throwDirection.multiplyScalar(throwForce));
    this.basketballVelocity.y = 6; // Higher upward component for more arc
    
    // Mark ball as thrown to prevent it from being pulled back to hand
    this.ballWasThrown = true;
    
    // Debug: Log ball state after throw with throw count
    console.log('===== BASKETBALL THROWN =====');
    console.log('Ball position:', this.basketball.position);
    console.log('Ball velocity:', this.basketballVelocity);
    console.log('Has ball:', this.hasBall);
    console.log('Ball visible:', this.basketball.visible);
    console.log('Ball was thrown flag set to:', this.ballWasThrown);
    console.log('=============================');
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    const delta = this.clock.getDelta();

    if (this.mixer) this.mixer.update(delta);
    this.handleMovement(delta);
    this.updateBasketballPhysics(delta);

    // Camera follow with free movement
    this.updateCameraPosition();

    this.renderer.render(this.scene, this.camera);
  }

  private handleMovement(delta: number): void {
    if (!this.avatar || this.isTransitioning) return;
    
    let moveDir = new THREE.Vector3(0, 0, 0);
    let newState = this.hasBall ? this.animationStates.holdingball : this.animationStates.idle;
    let currentSpeed = this.moveSpeed;

    // Get camera forward and right vectors (relative to camera view)
    const cameraForward = new THREE.Vector3(
      -Math.sin(this.cameraAngle),
      0,
      -Math.cos(this.cameraAngle)
    );
    const cameraRight = new THREE.Vector3(
      Math.cos(this.cameraAngle),
      0,
      -Math.sin(this.cameraAngle)
    );

    // Check for sprint (Shift key)
    const isSprinting = this.keys['shift'];
    if (isSprinting) {
      currentSpeed = this.sprintSpeed;
    }

    // Z: forward, S: backward, Q: left, D: right (relative to camera)
    if (this.keys['z']) {
      moveDir.add(cameraForward);
      if (this.hasBall) {
        newState = this.animationStates.holdingball;
      } else if (isSprinting) {
        newState = this.animationStates.running;
      } else {
        newState = this.animationStates.forward;
      }
    }
    if (this.keys['s']) {
      moveDir.sub(cameraForward);
      if (this.hasBall) {
        newState = this.animationStates.holdingball;
      } else {
        newState = this.animationStates.backward;
      }
    }
    if (this.keys['q']) {
      moveDir.sub(cameraRight);
      if (this.hasBall) {
        newState = this.animationStates.holdingball;
      } else if (isSprinting) {
        newState = this.animationStates.running;
      } else {
        newState = this.animationStates.forward;
      }
    }
    if (this.keys['d']) {
      moveDir.add(cameraRight);
      if (this.hasBall) {
        newState = this.animationStates.holdingball;
      } else if (isSprinting) {
        newState = this.animationStates.running;
      } else {
        newState = this.animationStates.forward;
      }
    }

    if (moveDir.length() > 0) {
      moveDir.normalize();
      
      // Calculate new position
      const movement = moveDir.clone().multiplyScalar(currentSpeed * delta);
      const newPosition = this.avatar.position.clone().add(movement);
      
      // Check for collision
      if (!this.checkCollision(newPosition)) {
        // No collision, move normally
        this.avatar.position.copy(newPosition);
        
        // Rotate avatar to movement direction
        const angle = Math.atan2(moveDir.x, moveDir.z);
        this.avatar.rotation.y = angle;
      }
      // If collision detected, don't move but still play animation and rotate
      else {
        // Still rotate to face movement direction even if blocked
        const angle = Math.atan2(moveDir.x, moveDir.z);
        this.avatar.rotation.y = angle;
      }
      
      if (newState !== this.currentState) {
        this.playAnimation(newState);
        this.currentState = newState;
      }
    } else {
      // Idle state
      const idleState = this.hasBall ? this.animationStates.holdingball : this.animationStates.idle;
      if (this.currentState !== idleState) {
        this.playAnimation(idleState);
        this.currentState = idleState;
      }
    }

    // Camera follow with free movement
    this.updateCameraPosition();
  }

  private updateCameraPosition(): void {
    if (!this.avatar) return;

    // Handle camera height adjustment with keyboard
    if (this.keys['arrowup']) this.cameraHeight += 0.02;
    if (this.keys['arrowdown']) this.cameraHeight -= 0.02;
    if (this.keys['arrowleft']) this.cameraAngle += 0.02;
    if (this.keys['arrowright']) this.cameraAngle -= 0.02;

    // Calculate camera position based on angle, distance, and height
    const x = this.avatar.position.x + Math.sin(this.cameraAngle) * this.cameraDistance;
    const z = this.avatar.position.z + Math.cos(this.cameraAngle) * this.cameraDistance;
    const y = this.avatar.position.y + this.cameraHeight + Math.sin(this.cameraVerticalAngle) * this.cameraDistance;

    // Smooth camera movement
    this.camera.position.lerp(new THREE.Vector3(x, y, z), 0.1);
    
    // Look at the character with slight offset upward
    const lookAtTarget = new THREE.Vector3(
      this.avatar.position.x,
      this.avatar.position.y + 1,
      this.avatar.position.z
    );
    this.camera.lookAt(lookAtTarget);
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    this.keys[key] = true;
    
    // Basketball controls
    if (key === 'e' && !this.hasBall && !this.isTransitioning && this.canPickupBall()) {
      // Pick up ball (crouch down)
      console.log('===== PICKING UP BALL =====');
      console.log('Ball position before pickup:', this.basketball.position);
      console.log('Ball velocity before pickup:', this.basketballVelocity);
      console.log('Can pickup ball:', this.canPickupBall());
      
      this.basketballVelocity.set(0, 0, 0); // Stop ball physics
      this.playAnimation(this.animationStates.standingtocrouched);
      this.currentState = this.animationStates.standingtocrouched;
      
      console.log('Ball velocity after pickup reset:', this.basketballVelocity);
      console.log('============================');
    } else if (key === 'r' && this.hasBall && !this.isTransitioning) {
      // Start throw animation (ball stays in hand until animation finishes)
      console.log('===== STARTING THROW ANIMATION =====');
      console.log('Has ball:', this.hasBall);
      console.log('Is transitioning:', this.isTransitioning);
      
      this.playAnimation(this.animationStates.throwball);
      this.currentState = this.animationStates.throwball;
      
      console.log('====================================');
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent) {
    this.keys[event.key.toLowerCase()] = false;
  }

  private createGameInstructions(): void {
    // Create instructions overlay
    const instructionsDiv = document.createElement('div');
    instructionsDiv.style.position = 'fixed';
    instructionsDiv.style.top = '20px';
    instructionsDiv.style.left = '20px';
    instructionsDiv.style.color = '#ffffff';
    instructionsDiv.style.fontFamily = 'Arial, sans-serif';
    instructionsDiv.style.fontSize = '16px';
    instructionsDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    instructionsDiv.style.padding = '20px';
    instructionsDiv.style.borderRadius = '10px';
    instructionsDiv.style.zIndex = '1000';
    instructionsDiv.style.maxWidth = '300px';
    instructionsDiv.style.lineHeight = '1.5';

    instructionsDiv.innerHTML = `
      <h3 style="margin: 0 0 15px 0; color: #ffaa00; font-size: 18px;">🏀 Basketball Game Controls</h3>
      
      <div style="margin-bottom: 15px;">
        <h4 style="margin: 0 0 8px 0; color: #ffdd44;">Movement:</h4>
        <div style="margin-left: 10px;">
          <div><strong>Z</strong> - Move Forward</div>
          <div><strong>S</strong> - Move Backward</div>
          <div><strong>Q</strong> - Move Left</div>
          <div><strong>D</strong> - Move Right</div>
          <div><strong>Shift</strong> - Sprint (hold while moving)</div>
        </div>
      </div>

      <div style="margin-bottom: 15px;">
        <h4 style="margin: 0 0 8px 0; color: #ffdd44;">Camera:</h4>
        <div style="margin-left: 10px;">
          <div><strong> HOLD LEFT MOUSE CLICK</strong> - Look Around</div>
          <div><strong>Mouse Wheel</strong> - Zoom In/Out</div>
          <div><strong>Arrow Keys</strong> - Fine Camera Control</div>
        </div>
      </div>

      <div style="margin-bottom: 15px;">
        <h4 style="margin: 0 0 8px 0; color: #ffdd44;">Basketball:</h4>
        <div style="margin-left: 10px;">
          <div><strong>E</strong> - Pick Up Ball (when near)</div>
          <div><strong>R</strong> - Throw Ball (when holding)</div>
        </div>
      </div>

      <div style="color: #aaaaaa; font-size: 14px; margin-top: 15px; padding-top: 10px; border-top: 1px solid #555;">
        💡 Walk near the basketball and press <strong>E</strong> to pick it up!<br>
        Then press <strong>R</strong> to throw it around the court.
      </div>

      <div style="color: #888888; font-size: 12px; margin-top: 15px; padding-top: 10px; border-top: 1px solid #444; text-align: center;">
        🎮 Created by <strong style="color: #ffaa00;">Dhafer Souid</strong>
      </div>
    `;

    // Add to body
    document.body.appendChild(instructionsDiv);

    // Add a toggle button to hide/show instructions
    const toggleButton = document.createElement('button');
    toggleButton.style.position = 'fixed';
    toggleButton.style.top = '20px';
    toggleButton.style.right = '20px';
    toggleButton.style.padding = '10px 15px';
    toggleButton.style.backgroundColor = '#ffaa00';
    toggleButton.style.color = '#000000';
    toggleButton.style.border = 'none';
    toggleButton.style.borderRadius = '5px';
    toggleButton.style.fontSize = '14px';
    toggleButton.style.fontWeight = 'bold';
    toggleButton.style.cursor = 'pointer';
    toggleButton.style.zIndex = '1001';
    toggleButton.textContent = 'Hide Instructions';

    let instructionsVisible = true;
    toggleButton.addEventListener('click', () => {
      instructionsVisible = !instructionsVisible;
      instructionsDiv.style.display = instructionsVisible ? 'block' : 'none';
      toggleButton.textContent = instructionsVisible ? 'Hide Instructions' : 'Show Instructions';
    });

    document.body.appendChild(toggleButton);
  }
}
