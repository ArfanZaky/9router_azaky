import { NextResponse } from "next/server";
import { deleteImageFile } from "@/lib/media/imageStore.js";
import { deleteFlowCharacter, getFlowCharacter, updateFlowCharacter } from "@/lib/db/repos/flowCharactersRepo.js";
import { deleteFlowImagesByCharacter } from "@/lib/db/repos/flowImagesRepo.js";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const character = await updateFlowCharacter(id, {
    ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
    ...(body.description !== undefined ? { description: String(body.description) } : {}),
    ...(body.style !== undefined ? { style: String(body.style) } : {}),
    ...(body.imageModel !== undefined ? { imageModel: String(body.imageModel) } : {}),
  });
  if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });
  return NextResponse.json(character);
}

/** Delete the character and every angle image it owns. */
export async function DELETE(_request, { params }) {
  const { id } = await params;
  const character = await getFlowCharacter(id);
  if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });
  const images = await deleteFlowImagesByCharacter(id);
  for (const image of images) deleteImageFile(image.path);
  await deleteFlowCharacter(id);
  return NextResponse.json({ ok: true, removedImages: images.length });
}
