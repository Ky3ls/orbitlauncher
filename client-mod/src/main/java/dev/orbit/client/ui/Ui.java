package dev.orbit.client.ui;

import dev.orbit.client.module.Modules;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** Small drawing helpers in the OrbitLauncher look (dark panels, ember accent). */
final class Ui {
	private Ui() {}

	static final int PANEL = 0xF0101012, CARD = 0xFF18181B, CARD_HI = 0xFF202024, LINE = 0x14FFFFFF, LINE2 = 0x26FFFFFF;
	static final int TEXT = 0xFFF4F4F5, SUB = 0xFFA1A1AA, MUTE = 0xFF6B6B74, ON = 0xFF1A0D05;

	static Font font() { return Minecraft.getInstance().font; }

	static boolean in(double mx, double my, int x, int y, int w, int h) { return mx >= x && mx < x + w && my >= y && my < y + h; }

	/** Rectangle with 1px rounded corners and a border. */
	static void box(GuiGraphicsExtractor g, int x, int y, int w, int h, int fill, int border) {
		g.fill(x + 1, y, x + w - 1, y + h, fill);
		g.fill(x, y + 1, x + 1, y + h - 1, fill);
		g.fill(x + w - 1, y + 1, x + w, y + h - 1, fill);
		if (border != 0) {
			g.fill(x + 1, y, x + w - 1, y + 1, border);
			g.fill(x + 1, y + h - 1, x + w - 1, y + h, border);
			g.fill(x, y + 1, x + 1, y + h - 1, border);
			g.fill(x + w - 1, y + 1, x + w, y + h - 1, border);
		}
	}

	/** Accent gradient (top to bottom, accent → lighter). */
	static void accentBox(GuiGraphicsExtractor g, int x, int y, int w, int h) {
		g.fillGradient(x + 1, y, x + w - 1, y + h, Modules.accent, Modules.accent2);
		g.fillGradient(x, y + 1, x + 1, y + h - 1, Modules.accent, Modules.accent2);
		g.fillGradient(x + w - 1, y + 1, x + w, y + h - 1, Modules.accent, Modules.accent2);
	}

	static void toggle(GuiGraphicsExtractor g, int x, int y, boolean on) {
		if (on) accentBox(g, x, y, 18, 10); else box(g, x, y, 18, 10, 0xFF24242A, 0xFF3A3A42);
		int kx = on ? x + 10 : x + 2;
		g.fill(kx, y + 2, kx + 6, y + 8, on ? 0xFFFFFFFF : 0xFF9A9AA4);
	}

	static void button(GuiGraphicsExtractor g, int x, int y, int w, int h, String label, boolean primary, boolean hover) {
		if (primary) accentBox(g, x, y, w, h); else box(g, x, y, w, h, hover ? CARD_HI : CARD, hover ? LINE2 : LINE);
		if (primary && hover) g.fill(x + 1, y, x + w - 1, y + h, 0x22FFFFFF);
		var f = font();
		g.text(f, label, x + (w - f.width(label)) / 2, y + (h - 8) / 2 + 1, primary ? ON : TEXT, false);
	}

	static String ellipsis(String s, int w) {
		var f = font();
		if (f.width(s) <= w) return s;
		while (s.length() > 1 && f.width(s + "…") > w) s = s.substring(0, s.length() - 1);
		return s + "…";
	}
}
