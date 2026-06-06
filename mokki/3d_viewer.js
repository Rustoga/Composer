// Mokki 3D Viewer
// This script initializes a Three.js scene for exploring a 3D environment.

import * as THREE from 'three';

function init3DViewer() {
    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcccccc); // Light gray background

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
        75, // Field of view
        window.innerWidth / window.innerHeight, // Aspect ratio
        0.1, // Near clipping plane
        1000 // Far clipping plane
    );
    camera.position.z = 5;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Animation loop
    const animate = function () {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    };

    animate();

    console.log("3D Viewer initialized.");
}

window.onload = init3DViewer;