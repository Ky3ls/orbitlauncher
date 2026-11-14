package dev.orbit.client.ui;

import dev.orbit.client.hud.Hud;
import dev.orbit.client.module.Module;
import dev.orbit.client.module.Modules;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;

/** Drag HUD modules around, snap to edges/center, scroll to resize, right click for settings. */
public class HudEditorScreen extends Screen {
	private final Screen parent;
	private Module drag;
	private double offX, offY;
	private boolean snapX, snapY;
	private final List<Object[]> boxes = new ArrayList<>();   // {module, int[]{x,y,w,h}}

	public HudEditorScreen(Screen parent) { super(Component.literal("HUD bearbeiten")); this.parent = parent; }

	@Override public boolean isPauseScreen() { return false; }
	@Override public void onClose() { Modules.save(); minecraft.gui.setScreen(parent); }

	/** No blur: you want to see the game while placing things. */
	@Override public void extractBackground(GuiGraphicsExtractor g, int mx, int my, float d) { g.fill(0, 0, width, height, 0x50000000); }

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float delta) {
		// guides
		int cx = width / 2, cy = height / 2;
		g.fill(cx, 0, cx + 1, height, snapX && drag != null ? Modules.accent : 0x18FFFFFF);
		g.fill(0, cy, width, cy + 1, snapY && drag != null ? Modules.accent : 0x18FFFFFF);

		boxes.clear();
		Hud.layout(g, true);
		Module hover = null;
		for (var m : Modules.ALL) {
			if (!m.hud || !m.enabled) continue;
			var p = Hud.draw(g, m, true);
			if (p == null) continue;
			boxes.add(new Object[] { m, p });
			if (Ui.in(mx, my, p[0], p[1], p[2], p[3])) hover = m;
		}
		for (var b : boxes) {
			var m = (Module) b[0]; var p = (int[]) b[1];
			boolean hi = m == drag || (drag == null && m == hover);
			int c = hi ? Modules.accent : 0x50FFFFFF;
			g.fill(p[0] - 1, p[1] - 1, p[0] + p[2] + 1, p[1], c);
			g.fill(p[0] - 1, p[1] + p[3], p[0] + p[2] + 1, p[1] + p[3] + 1, c);
			g.fill(p[0] - 1, p[1], p[0], p[1] + p[3], c);
			g.fill(p[0] + p[2], p[1], p[0] + p[2] + 1, p[1] + p[3], c);
			if (hi) {
				String label = m.name + "  " + Math.round(m.scale() * 100) + "%";
				int ly = p[1] > 12 ? p[1] - 11 : p[1] + p[3] + 3;
				g.fill(p[0] - 1, ly - 1, p[0] + font.width(label) + 3, ly + 9, 0xE0101012);
				g.text(font, label, p[0] + 1, ly, Modules.accent, false);
			}
		}

		// toolbar
		int bw = 260, bx = (width - bw) / 2, by = height - 34;
		Ui.box(g, bx, by, bw, 26, 0xF0101012, Ui.LINE2);
		g.text(font, "Ziehen · Mausrad = Größe · Rechtsklick = Optionen", bx + 8, by + 4, Ui.SUB, false);
		g.text(font, "Esc = Fertig", bx + 8, by + 15, Ui.MUTE, false);
		boolean dh = Ui.in(mx, my, bx + bw - 54, by + 4, 48, 18);
		Ui.button(g, bx + bw - 54, by + 4, 48, 18, "Fertig", true, dh);
	}

	private Object[] hit(double mx, double my) {
		for (int i = boxes.size() - 1; i >= 0; i--) { var p = (int[]) boxes.get(i)[1]; if (Ui.in(mx, my, p[0], p[1], p[2], p[3])) return boxes.get(i); }
		return null;
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean dbl) {
		int bw = 260, bx = (width - bw) / 2, by = height - 34;
		if (Ui.in(e.x(), e.y(), bx + bw - 54, by + 4, 48, 18)) { onClose(); return true; }
		var h = hit(e.x(), e.y());
		if (h == null) return super.mouseClicked(e, dbl);
		var m = (Module) h[0]; var p = (int[]) h[1];
		if (e.button() == 1) { Modules.save(); minecraft.gui.setScreen(new OrbitMenuScreen(this, m)); return true; }
		drag = m; offX = e.x() - p[0]; offY = e.y() - p[1];
		return true;
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent e, double dx, double dy) {
		if (drag == null) return super.mouseDragged(e, dx, dy);
		int[] p = null;
		for (var b : boxes) if (b[0] == drag) p = (int[]) b[1];
		if (p == null) return true;
		double x = e.x() - offX, y = e.y() - offY;
		int w = p[2], h = p[3], snap = 4;
		snapX = false; snapY = false;
		if (Math.abs(x) < snap) x = 0;
		if (Math.abs(x + w - width) < snap) x = width - w;
		if (Math.abs(x + w / 2.0 - width / 2.0) < snap) { x = width / 2.0 - w / 2.0; snapX = true; }
		if (Math.abs(y) < snap) y = 0;
		if (Math.abs(y + h - height) < snap) y = height - h;
		if (Math.abs(y + h / 2.0 - height / 2.0) < snap) { y = height / 2.0 - h / 2.0; snapY = true; }
		// snap to other modules' edges
		for (var b : boxes) {
			if (b[0] == drag) continue;
			var q = (int[]) b[1];
			if (Math.abs(x - q[0]) < snap) x = q[0];
			if (Math.abs(y - (q[1] + q[3] + 2)) < snap) y = q[1] + q[3] + 2;
			if (Math.abs(y + h + 2 - q[1]) < snap) y = q[1] - h - 2;
		}
		drag.placed = true;
		drag.x = (float) Math.max(0, Math.min(1, x / width));
		drag.y = (float) Math.max(0, Math.min(1, y / height));
		return true;
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent e) {
		if (drag != null) { drag = null; Modules.save(); return true; }
		return super.mouseReleased(e);
	}

	@Override
	public boolean mouseScrolled(double mx, double my, double h, double v) {
		var hitBox = hit(mx, my);
		if (hitBox == null || v == 0) return false;
		var m = (Module) hitBox[0];
		double s = Math.max(0.5, Math.min(2.5, Math.round((m.scale() + (v > 0 ? 0.1 : -0.1)) * 10) / 10.0));
		m.set("scale", dev.orbit.client.module.Setting.fmt(s));
		return true;
	}
}
