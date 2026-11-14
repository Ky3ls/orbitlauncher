package dev.orbit.client.hud;

import dev.orbit.client.module.Module;
import dev.orbit.client.module.Modules;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** Custom crosshair drawn with plain rectangles (no textures). */
public final class Crosshair {
	private Crosshair() {}

	public static boolean active() {
		var mc = Minecraft.getInstance();
		return Modules.on("crosshair") && mc.options.getCameraType().isFirstPerson() && !dev.orbit.client.State.freelook;
	}

	public static void render(GuiGraphicsExtractor g) { draw(g, Modules.get("crosshair"), g.guiWidth() / 2, g.guiHeight() / 2); }

	public static void draw(GuiGraphicsExtractor g, Module m, int cx, int cy) {
		int size = (int) m.num("size"), gap = (int) m.num("gap"), t = Math.max(1, (int) m.num("thick"));
		int c = Modules.color(m.get("ccolor"), 0);
		boolean ol = m.bool("outline");
		String style = m.get("style");
		int h0 = t / 2, h1 = t - h0;   // half thickness split
		switch (style) {
			case "Punkt" -> rect(g, cx - h0 - 1, cy - h0 - 1, cx + h1 + 1, cy + h1 + 1, c, ol);
			case "Kreis" -> {
				int r = gap + size / 2 + 2;
				for (int a = 0; a < 360; a += 6) {
					double rad = Math.toRadians(a);
					int x = cx + (int) Math.round(Math.cos(rad) * r), y = cy + (int) Math.round(Math.sin(rad) * r);
					rect(g, x - h0, y - h0, x + h1, y + h1, c, false);
				}
				rect(g, cx - 1, cy - 1, cx + 1, cy + 1, c, ol);
			}
			case "X" -> {
				g.pose().pushMatrix();
				g.pose().translate(cx, cy);
				g.pose().rotate((float) Math.toRadians(45));
				plus(g, 0, 0, size, gap, h0, h1, c, ol, false);
				g.pose().popMatrix();
			}
			case "T" -> plus(g, cx, cy, size, gap, h0, h1, c, ol, true);
			default -> {
				plus(g, cx, cy, size, gap, h0, h1, c, ol, false);
				if (style.equals("Plus+Punkt")) rect(g, cx - h0, cy - h0, cx + h1, cy + h1, c, ol);
			}
		}
	}

	private static void plus(GuiGraphicsExtractor g, int cx, int cy, int size, int gap, int h0, int h1, int c, boolean ol, boolean noTop) {
		rect(g, cx - gap - size, cy - h0, cx - gap, cy + h1, c, ol);            // left
		rect(g, cx + gap + 1, cy - h0, cx + gap + 1 + size, cy + h1, c, ol);    // right
		if (!noTop) rect(g, cx - h0, cy - gap - size, cx + h1, cy - gap, c, ol); // top
		rect(g, cx - h0, cy + gap + 1, cx + h1, cy + gap + 1 + size, c, ol);    // bottom
	}

	private static void rect(GuiGraphicsExtractor g, int x0, int y0, int x1, int y1, int c, boolean outline) {
		if (outline) g.fill(x0 - 1, y0 - 1, x1 + 1, y1 + 1, 0xC0000000);
		g.fill(x0, y0, x1, y1, c);
	}
}
