import {
  Bone,
  DoubleSide,
  Group,
  MeshStandardMaterial,
  Object3D,
  PropertyBinding,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadModel } from "@/lib/load-model";
import { RIG_PATH } from "./lab-assets";

export type BoneRest = { position: Vector3; quaternion: Quaternion; scale: Vector3 };

export type LabRig = {
  scene: Group;
  /** the large body surface mesh */
  body: SkinnedMesh;
  skinMeshes: SkinnedMesh[];
  /** the skeleton exactly as the file defines it (A-pose bind) */
  skeleton: Skeleton;
  bone: (name: string) => Bone;
  hasBone: (name: string) => boolean;
  nativeRest: Map<Bone, BoneRest>;
  bodyMaterial: MeshStandardMaterial;
};

export function snapshotLocals(bones: Bone[]): Map<Bone, BoneRest> {
  const map = new Map<Bone, BoneRest>();
  for (const bone of bones) {
    map.set(bone, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    });
  }
  return map;
}

export function restoreLocals(rig: LabRig, snapshot: Map<Bone, BoneRest>) {
  for (const [bone, rest] of snapshot) {
    bone.position.copy(rest.position);
    bone.quaternion.copy(rest.quaternion);
    bone.scale.copy(rest.scale);
  }
  rig.scene.updateMatrixWorld(true);
}

export async function loadRig(): Promise<LabRig> {
  const gltf = await loadModel(RIG_PATH);
  // Clone so the lab never mutates the shared, cached GLTF.
  const scene = cloneSkinned(gltf.scene) as Group;

  const skinMeshes: SkinnedMesh[] = [];
  scene.traverse((object: Object3D) => {
    if ((object as SkinnedMesh).isSkinnedMesh) skinMeshes.push(object as SkinnedMesh);
  });
  if (skinMeshes.length === 0) throw new Error("The Innerscene file contains no skinned mesh.");

  const body = skinMeshes.reduce((best, mesh) =>
    mesh.geometry.attributes.position.count > best.geometry.attributes.position.count ? mesh : best,
  );
  const skeleton = body.skeleton;

  const bodyMaterial = new MeshStandardMaterial({
    color: "#cdbfae",
    roughness: 0.72,
    metalness: 0,
    side: DoubleSide,
  });
  for (const mesh of skinMeshes) {
    mesh.material = bodyMaterial;
    mesh.frustumCulled = false;
  }

  scene.updateMatrixWorld(true);
  skeleton.update();

  const byName = new Map<string, Bone>(skeleton.bones.map((bone) => [bone.name, bone]));
  const lookup = (name: string) => byName.get(PropertyBinding.sanitizeNodeName(name));

  return {
    scene,
    body,
    skinMeshes,
    skeleton,
    bone: (name: string) => {
      const bone = lookup(name);
      if (!bone) throw new Error(`The Innerscene skeleton has no bone named "${name}".`);
      return bone;
    },
    hasBone: (name: string) => lookup(name) !== undefined,
    nativeRest: snapshotLocals(skeleton.bones),
    bodyMaterial,
  };
}

export function boneWorldPosition(rig: LabRig, name: string, target = new Vector3()): Vector3 {
  return rig.bone(name).getWorldPosition(target);
}
