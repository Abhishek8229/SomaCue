import { Vector3 } from "three";
import { POSTURE_DEFS } from "./postures";
import type { Posture } from "./vocabulary";

/**
 * Camera direction (from target toward camera) per posture and view button.
 * Standing, seated and hands-and-knees use Anterior / Posterior. Lying
 * postures use Top / Side so the posture and movement stay readable.
 * The body faces +Z standing; lying supine the head points to -Z, prone to +Z.
 */
const VIEW_DIRECTIONS: Record<Posture, [Vector3, Vector3]> = {
  standing: [new Vector3(0.28, 0.16, 1), new Vector3(-0.28, 0.16, -1)],
  seated: [new Vector3(0.32, 0.2, 1), new Vector3(-0.32, 0.22, -1)],
  quadruped: [new Vector3(0.95, 0.4, 0.7), new Vector3(-0.9, 0.75, -0.55)],
  supine: [new Vector3(0.3, 1, 0.5), new Vector3(1, 0.2, 0)],
  prone: [new Vector3(0.3, 1, -0.5), new Vector3(1, 0.2, 0)],
};

export const CAMERA_FOV_DEG = 32;

export function viewLabels(posture: Posture): [string, string] {
  return POSTURE_DEFS[posture].views;
}

/**
 * The view an exercise opens with: lying postures start on Side so the
 * movement is easy to read; standing, seated and hands-and-knees start on the front.
 */
export function defaultView(posture: Posture): 0 | 1 {
  return POSTURE_DEFS[posture].lying ? 1 : 0;
}

export function viewDescription(posture: Posture, view: 0 | 1) {
  const label = viewLabels(posture)[view].toLowerCase();
  return POSTURE_DEFS[posture].lying ? `${label} view · lying` : `${label} view`;
}

/** Camera position and target that frame a sphere of `radius` around `center`. */
export function cameraFor(posture: Posture, view: 0 | 1, center: Vector3, radius: number, aspect = 1) {
  const direction = VIEW_DIRECTIONS[posture][view].clone().normalize();
  const halfFov = (CAMERA_FOV_DEG * Math.PI) / 360;
  // Fit the sphere in the narrower of the two frustum angles.
  const horizontal = Math.atan(Math.tan(halfFov) * Math.max(0.4, aspect));
  const fit = Math.min(halfFov, horizontal);
  const distance = (radius / Math.sin(fit)) * 1.12;
  return { position: center.clone().addScaledVector(direction, distance), target: center.clone(), distance };
}
