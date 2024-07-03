import { vec3n, mat4n, quatn } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.min.js';

export class FPSCameraController {
    #pitch = 0.0;
    #yaw = 0.0;
    #velocity = vec3n.fromValues(0, 0, 0);
    #acceleration = 20.0;
    #maxSpeed = 1;
    #decay = 0.9;
    #pointerSensitivity = 0.002;
    #keys = [];
    #pointerMoveHandler;
    #position = vec3n.create(0, 20, 100);
    #rotation = quatn.identity();

    constructor(canvas) {
        this.#pointerMoveHandler = e => this.#onMouseMove(e);
        canvas.ownerDocument.addEventListener('keydown', e => { this.#keys[e.code] = true; });
        canvas.ownerDocument.addEventListener('keyup', e => { this.#keys[e.code] = false; });
        canvas.addEventListener('click', _ => { canvas.requestPointerLock(); });
        canvas.ownerDocument.addEventListener('pointerlockchange', _ => {
            if (canvas.ownerDocument.pointerLockElement === canvas) {
                canvas.ownerDocument.addEventListener('pointermove', this.#pointerMoveHandler);
            } else {
                canvas.ownerDocument.removeEventListener('pointermove', this.#pointerMoveHandler);
            }
        });
    }

    #onMouseMove(e) {
        this.#pitch -= e.movementY * this.#pointerSensitivity;
        this.#yaw -= e.movementX * this.#pointerSensitivity;
        const tau = Math.PI * 2;
        const halfpi = Math.PI / 2;
        this.#pitch = Math.min(Math.max(this.#pitch, -halfpi), halfpi);
        this.#yaw = ((this.#yaw % tau) + tau) % tau;
    }

    update(dt = 0.0) {
        const keyFront = 'KeyW';
        const keyBack = 'KeyS';
        const keyLeft = 'KeyA';
        const keyRight = 'KeyD';

        const cos = Math.cos(this.#yaw);
        const sin = Math.sin(this.#yaw);
        const forward = [-sin, 0, -cos];
        const right = [cos, 0, -sin];

        const acc = vec3n.create(0, 0, 0);
        if (this.#keys[keyFront]) {
            vec3n.add(acc, forward, acc);
        }
        if (this.#keys[keyBack]) {
            vec3n.sub(acc, forward, acc);
        }
        if (this.#keys[keyRight]) {
            vec3n.add(acc, right, acc);
        }
        if (this.#keys[keyLeft]) {
            vec3n.sub(acc, right, acc);
        }
        vec3n.addScaled(this.#velocity, acc, dt * this.#acceleration, this.#velocity);

        if (![keyFront, keyBack, keyLeft, keyRight].some(code => this.#keys[code])) {
            vec3n.scale(this.#velocity, Math.exp(dt * Math.log(1 - this.#decay)), this.#velocity);
        }
        const speed = vec3n.length(this.#velocity);
        if (speed > this.#maxSpeed) {
            vec3n.scale(this.#velocity, this.#maxSpeed / speed, this.#velocity);
        }
        vec3n.addScaled(this.#position, this.#velocity, dt, this.#position);
        
        const rotation = quatn.identity();
        quatn.rotateY(rotation, this.#yaw, rotation);
        quatn.rotateX(rotation, this.#pitch, rotation);
        this.#rotation = rotation;
    }

    get position() {
        return this.#position;
    }

    get view() {
        const mat = mat4n.fromQuat(this.#rotation);
        mat4n.setTranslation(mat, this.#position, mat);
        return mat4n.inverse(mat);
    }
}
