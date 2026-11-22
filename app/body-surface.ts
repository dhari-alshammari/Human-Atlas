// Simple body areas by position (2026-11-22), the same areas as the doctor's server (lib/body-regions.ts in
// your-smart-doctor-ai). The female model's skin is a single part, so a tap on it is placed by where it lands; the
// doctor's highlight colours the same area of the skin.
import type { Sex } from './anatomy';

export type Side = 'right' | 'left' | null;

// The male model (BodyParts3D): x is the body's left when positive, y height in metres, z towards the front.
function male([x, y, z]: number[]): string {
  const side = Math.abs(x);
  if (y >= 1.52) return 'head';
  if (y >= 1.42) return side > 0.12 ? 'shoulder' : 'neck';
  if (side >= 0.2 && y < 0.95) return y < 0.8 ? 'fingers' : 'hand';
  if (side >= 0.17 && y >= 0.95 && y < 1.12) return 'forearm';
  if (side >= 0.15 && y >= 1.12 && y < 1.36) return 'upper_arm';
  if (side >= 0.12 && y >= 1.33) return 'shoulder';
  if (y >= 1.2) return z < -0.04 ? 'upper_back' : 'chest';
  if (y >= 1.0) return z < -0.03 ? 'lower_back' : 'abdomen';
  if (y >= 0.86) return z < -0.04 ? 'buttock' : side > 0.06 ? 'hip' : 'pelvis';
  if (y >= 0.52) return 'thigh';
  if (y >= 0.43) return z < -0.02 ? 'knee_back' : 'knee';
  if (y >= 0.09) return z < -0.01 ? 'calf' : 'shin';
  if (y >= 0.05) return 'ankle';
  return z < -0.03 ? 'heel' : 'foot_top';
}

// The female model (HuBMAP female v1.10): 1.66 m, arms further out, shoulders lower, centred about 8 cm further back.
function female([x, y, z]: number[]): string {
  const side = Math.abs(x), front = z + 0.08;
  if (y >= 1.46) return 'head';
  if (y >= 1.36) return side > 0.11 ? 'shoulder' : 'neck';
  if (side >= 0.38 && y < 0.95) return y < 0.86 ? 'fingers' : 'hand';
  if (side >= 0.27 && y >= 0.9 && y < 1.11) return 'forearm';
  // The arm hangs beside the waist: skin that far out above the hips is the arm, not the belly.
  if (side >= 0.2 && y >= 0.96 && y < 1.11) return 'forearm';
  if (side >= 0.165 && y >= 1.11 && y < 1.3) return 'upper_arm';
  if (side >= 0.11 && y >= 1.25) return 'shoulder';
  if (y >= 1.15) return front < -0.04 ? 'upper_back' : 'chest';
  if (y >= 0.96) return front < -0.03 ? 'lower_back' : 'abdomen';
  if (y >= 0.83) return front < -0.04 ? 'buttock' : side > 0.07 ? 'hip' : 'pelvis';
  if (y >= 0.5) return 'thigh';
  if (y >= 0.41) return front < -0.02 ? 'knee_back' : 'knee';
  if (y >= 0.085) return front < -0.01 ? 'calf' : 'shin';
  if (y >= 0.05) return 'ankle';
  return z < -0.06 ? 'heel' : 'foot_top';
}

export const areaAt = (sex: Sex, point: number[]) => (sex === 'female' ? female(point) : male(point));
// Both models: a positive x is the body's left side. The middle of the body has no side.
export const sideAt = (point: number[]): Side => (point[0] > 0.03 ? 'left' : point[0] < -0.03 ? 'right' : null);

// The id of a selected or highlighted skin area, and the name sent to the doctor («Body surface: chest (left)»).
export const surfaceId = (area: string, side: Side) => `surface:${area}:${side ?? ''}`;
export const parseSurface = (id: string): { area: string; side: Side } | null => {
  const match = /^surface:([a-z_]+):(right|left)?$/.exec(id);
  return match ? { area: match[1], side: (match[2] as Side) ?? null } : null;
};
export const surfaceName = (area: string, side: Side) => `Body surface: ${area.replace(/_/g, ' ')}${side ? ` (${side})` : ''}`;
// A doctor's highlight of an area matches a skin point when the area is the same and the side fits («both» or none).
export const sideFits = (wanted: string | null | undefined, side: Side) => !wanted || wanted === 'both' || !side || wanted === side;
