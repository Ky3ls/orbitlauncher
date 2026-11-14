package dev.orbit.client.ui;

import dev.orbit.client.module.Module;
import dev.orbit.client.module.Modules;
import dev.orbit.client.module.Setting;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

import java.util.List;

/** The Orbit Client menu (Right Shift): categories, module cards with toggles, per-module settings, HUD editor. */
public class OrbitMenuScreen extends Screen {
	private static final String[] CATS = { "Alle", "HUD", "PvP", "Grafik", "Komfort" };
	private static int cat = 0;
	private final Screen parent;
	private Module detail;
	private double scroll;
	private int px, py, pw, ph;
	private long opened = System.currentTimeMillis();

	public OrbitMenuScreen(Screen parent) { this(parent, null); }
	public OrbitMenuScreen(Screen parent, Module detail) { super(Component.literal("Orbit Client")); this.parent = parent; this.detail = detail; }

	@Override public boolean isPauseScreen() { return false; }

	@Override public void onClose() { Modules.save(); minecraft.gui.setScreen(parent); }

	private List<Module> visible() {
		return Modules.ALL.stream().filter(m -> cat == 0 || m.category.label.equals(CATS[cat])).toList();
	}

	private void layout() {
		pw = Math.min(480, width - 24); ph = Math.min(300, height - 24);
		px = (width - pw) / 2; py = (height - ph) / 2;
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float delta) {
		layout();
		float t = Math.min(1f, (System.currentTimeMillis() - opened) / 220f);
		float ease = 1 - (1 - t) * (1 - t) * (1 - t);
		g.pose().pushMatrix();
		g.pose().translate(0, (1 - ease) * 12);

		var f = font;
		Ui.box(g, px, py, pw, ph, Ui.PANEL, Ui.LINE2);
		g.fill(px + 1, py, px + pw - 1, py + 1, Modules.accent);

		// ---- sidebar
		int sx = px + 10, sw = 96;
		g.text(f, "ORBIT", sx, py + 12, Modules.accent, true);
		g.text(f, "CLIENT", sx + f.width("ORBIT "), py + 12, Ui.TEXT, true);
		g.text(f, "v1.0 · 26.3", sx, py + 24, Ui.MUTE, false);
		int cy = py + 44;
		for (int i = 0; i < CATS.length; i++) {
			boolean on = i == cat && detail == null, hov = Ui.in(mx, my, sx - 4, cy, sw, 18);
			if (on) { Ui.box(g, sx - 4, cy, sw, 18, (Modules.accent & 0xFFFFFF) | 0x30000000, (Modules.accent & 0xFFFFFF) | 0x60000000); g.fill(sx - 4, cy + 4, sx - 3, cy + 14, Modules.accent); }
			else if (hov) Ui.box(g, sx - 4, cy, sw, 18, 0x10FFFFFF, 0);
			g.text(f, CATS[i], sx + 4, cy + 5, on ? Ui.TEXT : hov ? Ui.TEXT : Ui.SUB, false);
			int cnt = countOn(i);
			String c = String.valueOf(cnt);
			g.text(f, c, sx + sw - 10 - f.width(c), cy + 5, on ? Modules.accent : Ui.MUTE, false);
			cy += 20;
		}
		boolean eh = Ui.in(mx, my, sx - 4, py + ph - 52, sw, 18);
		Ui.button(g, sx - 4, py + ph - 52, sw, 18, "HUD bearbeiten", true, eh);
		boolean rh = Ui.in(mx, my, sx - 4, py + ph - 30, sw, 18);
		Ui.button(g, sx - 4, py + ph - 30, sw, 18, "Zurücksetzen", false, rh);
		g.fill(px + sw + 14, py + 10, px + sw + 15, py + ph - 10, Ui.LINE);

		// ---- content
		int cx = px + sw + 24, cw = pw - sw - 34;
		g.enableScissor(cx - 2, py + 8, cx + cw + 2, py + ph - 8);
		if (detail == null) grid(g, mx, my, cx, cw); else settings(g, mx, my, cx, cw);
		g.disableScissor();
		g.pose().popMatrix();

		String hint = "Rechts-Shift Menü · C Zoom · Alt Freelook · G Fullbright";
		g.text(f, hint, (width - f.width(hint)) / 2, py + ph + 6 > height - 10 ? height - 10 : py + ph + 6, 0xAAFFFFFF, true);
	}

	private int countOn(int c) {
		int n = 0;
		for (var m : Modules.ALL) if (m.enabled && (c == 0 || m.category.label.equals(CATS[c]))) n++;
		return n;
	}

	private static final int CARD_H = 38, GAP = 6;

	private void grid(GuiGraphicsExtractor g, int mx, int my, int cx, int cw) {
		var f = font;
		g.text(f, CATS[cat].equals("Alle") ? "Alle Module" : CATS[cat], cx, py + 12, Ui.TEXT, false);
		String sub = countOn(cat) + " aktiv · Klick = an/aus · Rechtsklick = Einstellungen";
		g.text(f, Ui.ellipsis(sub, cw), cx, py + 24, Ui.MUTE, false);
		int colW = (cw - GAP) / 2;
		var list = visible();
		int top = py + 40 - (int) scroll;
		for (int i = 0; i < list.size(); i++) {
			var m = list.get(i);
			int x = cx + (i % 2) * (colW + GAP), y = top + (i / 2) * (CARD_H + GAP);
			boolean hov = Ui.in(mx, my, x, y, colW, CARD_H) && my > py + 36 && my < py + ph - 8;
			int fill = m.enabled ? blend(Ui.CARD, Modules.accent, 0.10f) : hov ? Ui.CARD_HI : Ui.CARD;
			Ui.box(g, x, y, colW, CARD_H, fill, m.enabled ? (Modules.accent & 0xFFFFFF) | 0x70000000 : hov ? Ui.LINE2 : Ui.LINE);
			g.text(f, Ui.ellipsis(m.name, colW - 46), x + 8, y + 8, Ui.TEXT, false);
			g.text(f, Ui.ellipsis(m.desc, colW - 16), x + 8, y + 22, Ui.MUTE, false);
			Ui.toggle(g, x + colW - 26, y + 7, m.enabled);
			if (!m.settings.isEmpty()) {
				boolean gh = Ui.in(mx, my, x + colW - 44, y + 4, 14, 16);
				g.text(f, "⚙", x + colW - 41, y + 8, gh ? Modules.accent : Ui.MUTE, false);
			}
		}
	}

	private int contentHeight() { return ((visible().size() + 1) / 2) * (CARD_H + GAP); }

	private void settings(GuiGraphicsExtractor g, int mx, int my, int cx, int cw) {
		var f = font; var m = detail;
		boolean bh = Ui.in(mx, my, cx, py + 10, 60, 12);
		g.text(f, "‹ Zurück", cx, py + 12, bh ? Modules.accent : Ui.SUB, false);
		g.text(f, m.name, cx, py + 28, Ui.TEXT, true);
		g.text(f, Ui.ellipsis(m.desc, cw), cx, py + 40, Ui.MUTE, false);
		int y = py + 58 - (int) scroll;
		row(g, mx, my, cx, cw, y, "Aktiv", null, m.enabled);
		y += 24;
		for (var s : m.settings) { row(g, mx, my, cx, cw, y, s.label, s, false); y += 24; }
		if (m.hud) {
			boolean hh = Ui.in(mx, my, cx, y + 4, 120, 18);
			Ui.button(g, cx, y + 4, 120, 18, "Position im HUD-Editor", false, hh);
		}
		if (m.id.equals("crosshair")) {
			Ui.box(g, cx + cw - 60, py + 10, 56, 40, 0xFF2A3A2A, Ui.LINE);
			dev.orbit.client.hud.Crosshair.draw(g, m, cx + cw - 32, py + 30);
		}
	}

	private void row(GuiGraphicsExtractor g, int mx, int my, int cx, int cw, int y, String label, Setting s, boolean active) {
		var f = font;
		boolean hov = Ui.in(mx, my, cx, y, cw, 20);
		Ui.box(g, cx, y, cw, 20, hov ? Ui.CARD_HI : Ui.CARD, Ui.LINE);
		g.text(f, label, cx + 8, y + 6, Ui.TEXT, false);
		if (s == null || s.type == Setting.Type.BOOL) {
			Ui.toggle(g, cx + cw - 26, y + 5, s == null ? active : Boolean.parseBoolean(detail.get(s.key)));
		} else {
			String v = s.display(detail.get(s.key));
			String shown = "‹ " + v + " ›";
			int col = s.key.equals("color") || s.key.equals("ccolor") ? Modules.color(v, 0) : Modules.accent;
			g.text(f, shown, cx + cw - 8 - f.width(shown), y + 6, col, false);
		}
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean dbl) {
		double mx = e.x(), my = e.y(); int btn = e.button();
		layout();
		int sx = px + 10, sw = 96;
		int cy = py + 44;
		for (int i = 0; i < CATS.length; i++) { if (Ui.in(mx, my, sx - 4, cy, sw, 18)) { cat = i; detail = null; scroll = 0; return true; } cy += 20; }
		if (Ui.in(mx, my, sx - 4, py + ph - 52, sw, 18)) { minecraft.gui.setScreen(new HudEditorScreen(this)); return true; }
		if (Ui.in(mx, my, sx - 4, py + ph - 30, sw, 18)) {
			for (var m : Modules.ALL) { m.enabled = m.defEnabled; m.x = m.defX; m.y = m.defY; m.placed = false; m.opts.clear(); }
			Modules.save(); return true;
		}
		int cx = px + sw + 24, cw = pw - sw - 34;
		if (my < py + 8 || my > py + ph - 8) return super.mouseClicked(e, dbl);
		if (detail == null) {
			int colW = (cw - GAP) / 2; var list = visible(); int top = py + 40 - (int) scroll;
			if (my < py + 36) return true;
			for (int i = 0; i < list.size(); i++) {
				var m = list.get(i);
				int x = cx + (i % 2) * (colW + GAP), y = top + (i / 2) * (CARD_H + GAP);
				if (!Ui.in(mx, my, x, y, colW, CARD_H)) continue;
				if (btn == 1 || (Ui.in(mx, my, x + colW - 44, y + 4, 14, 16) && !m.settings.isEmpty())) { detail = m; scroll = 0; }
				else { m.enabled = !m.enabled; Modules.save(); }
				return true;
			}
		} else {
			if (Ui.in(mx, my, cx, py + 10, 60, 12)) { detail = null; scroll = 0; return true; }
			int y = py + 58 - (int) scroll;
			if (Ui.in(mx, my, cx, y, cw, 20)) { detail.enabled = !detail.enabled; Modules.save(); return true; }
			y += 24;
			for (var s : detail.settings) {
				if (Ui.in(mx, my, cx, y, cw, 20)) { detail.set(s.key, s.next(detail.get(s.key), btn == 1 ? -1 : 1)); Modules.save(); return true; }
				y += 24;
			}
			if (detail.hud && Ui.in(mx, my, cx, y + 4, 120, 18)) { minecraft.gui.setScreen(new HudEditorScreen(this)); return true; }
		}
		return super.mouseClicked(e, dbl);
	}

	@Override
	public boolean mouseScrolled(double mx, double my, double h, double v) {
		layout();
		int max = detail == null ? Math.max(0, contentHeight() - (ph - 50)) : Math.max(0, (detail.settings.size() + 2) * 24 - (ph - 70));
		scroll = Math.max(0, Math.min(max, scroll - v * 16));
		return true;
	}

	static int blend(int a, int b, float t) {
		int ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
		return 0xFF000000 | (int) (ar + (br - ar) * t) << 16 | (int) (ag + (bg - ag) * t) << 8 | (int) (ab + (bb - ab) * t);
	}
}
