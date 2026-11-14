package dev.orbit.client.hud;

import dev.orbit.client.State;
import dev.orbit.client.module.Module;
import dev.orbit.client.module.Modules;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;

import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Draws all enabled HUD modules. Also used by the HUD editor (preview = true shows sample values). */
public final class Hud {
	private Hud() {}

	public static final int PAD = 4, LINE = 10;
	private static final int BG = 0x8C0A0A0B;

	public record Box(int w, int h) {}

	public static void render(GuiGraphicsExtractor g, DeltaTracker dt) {
		var mc = Minecraft.getInstance();
		if (mc.player == null) return;
		if (mc.gui.screen() instanceof dev.orbit.client.ui.HudEditorScreen) return;   // the editor draws them itself
		layout(g, false);
		for (var m : Modules.ALL) if (m.hud && m.enabled) draw(g, m, false);
	}

	/** Anchor of each module for the automatic layout. */
	private static String anchor(String id) {
		return switch (id) {
			case "clock", "memory", "session", "potions" -> "tr";
			case "keystrokes", "sprint" -> "bl";
			case "armor" -> "br";
			case "reach", "combo" -> "c";
			default -> "tl";
		};
	}

	private static final java.util.Map<String, int[]> AUTO = new java.util.HashMap<>();

	/** Stacks all modules that were never dragged: top-left/top-right downwards, bottom corners upwards, combat info under the crosshair. */
	public static void layout(GuiGraphicsExtractor g, boolean preview) {
		AUTO.clear();
		int W = g.guiWidth(), H = g.guiHeight(), m0 = 3, gap = 2;
		var cur = new java.util.HashMap<String, Integer>();
		cur.put("tl", m0); cur.put("tr", m0); cur.put("bl", H - m0); cur.put("br", H - m0 - 24); cur.put("c", H / 2 + 14);
		// bottom anchors stack upwards: iterate them in reverse so the list order reads top→bottom
		var list = new ArrayList<>(Modules.ALL);
		java.util.Collections.reverse(list);
		for (var pass : new boolean[] { true, false }) {
			for (var m : pass ? list : Modules.ALL) {
				if (!m.hud || !m.enabled || m.placed) continue;
				String a = anchor(m.id);
				boolean up = a.startsWith("b");
				if (up != pass) continue;
				if (!preview && isEmpty(m)) continue;
				var b = size(m, preview); float s = m.scale();
				int w = Math.round(b.w() * s), h = Math.round(b.h() * s);
				int x = switch (a) { case "tr", "br" -> W - m0 - w; case "c" -> (W - w) / 2; default -> m0; };
				int y;
				if (up) { y = cur.get(a) - h; cur.put(a, y - gap); }
				else { y = cur.get(a); cur.put(a, y + h + gap); }
				AUTO.put(m.id, new int[] { x, y });
			}
		}
	}

	/** Pixel position of a module (clamped into the screen). */
	public static int[] pos(GuiGraphicsExtractor g, Module m, Box b) {
		float s = m.scale();
		int w = Math.round(b.w() * s), h = Math.round(b.h() * s);
		int x = Math.round(m.x * g.guiWidth()), y = Math.round(m.y * g.guiHeight());
		var auto = m.placed ? null : AUTO.get(m.id);
		if (auto != null) { x = auto[0]; y = auto[1]; }
		x = Math.max(0, Math.min(g.guiWidth() - w, x));
		y = Math.max(0, Math.min(g.guiHeight() - h, y));
		return new int[] { x, y, w, h };
	}

	public static Box size(Module m, boolean preview) {
		var font = Minecraft.getInstance().font;
		return switch (m.id) {
			case "keystrokes" -> new Box(3 * 24 - 2, 2 * 24 - 2 + (m.bool("mouse") ? 24 : 0) + (m.bool("space") ? 14 : 0));
			case "armor" -> { int n = armorItems(preview).size(); yield new Box(18 + (m.get("dura").equals("Aus") ? 0 : 34), Math.max(1, n) * 18); }
			default -> {
				var lines = lines(m, preview);
				int w = 0; for (var l : lines) w = Math.max(w, font.width(l));
				yield new Box(w + PAD * 2, lines.size() * LINE + PAD * 2 - 2);
			}
		};
	}

	/** Returns null when the module currently has nothing to show (e.g. no effects). */
	public static int[] draw(GuiGraphicsExtractor g, Module m, boolean preview) {
		var b = size(m, preview);
		if (!preview && isEmpty(m)) return null;
		var p = pos(g, m, b);
		float s = m.scale();
		g.pose().pushMatrix();
		g.pose().translate(p[0], p[1]);
		g.pose().scale(s, s);
		switch (m.id) {
			case "keystrokes" -> keystrokes(g, m);
			case "armor" -> armor(g, m, preview);
			default -> text(g, m, lines(m, preview), b);
		}
		g.pose().popMatrix();
		return p;
	}

	private static boolean isEmpty(Module m) {
		var mc = Minecraft.getInstance();
		return switch (m.id) {
			case "potions" -> mc.player.getActiveEffects().isEmpty();
			case "reach" -> State.lastReach < 0 || System.currentTimeMillis() - State.lastReachAt > 3000;
			case "combo" -> State.combo < 2;
			case "armor" -> armorItems(false).isEmpty();
			case "sprint" -> !(mc.player.isSprinting() || mc.player.isShiftKeyDown());
			default -> false;
		};
	}

	private static int color(Module m, int i) { return Modules.color(m.get("color"), i); }

	private static void text(GuiGraphicsExtractor g, Module m, List<String> lines, Box b) {
		var font = Minecraft.getInstance().font;
		if (m.bool("bg")) {
			g.fill(0, 0, b.w(), b.h(), BG);
			g.fill(0, 0, 1, b.h(), Modules.accent);
		}
		int y = PAD;
		for (int i = 0; i < lines.size(); i++) {
			g.text(font, lines.get(i), PAD + (m.bool("bg") ? 1 : 0), y, color(m, i * 3), m.bool("shadow"));
			y += LINE;
		}
	}

	public static List<String> lines(Module m, boolean preview) {
		var mc = Minecraft.getInstance();
		var p = mc.player;
		var out = new ArrayList<String>();
		boolean live = p != null;
		switch (m.id) {
			case "fps" -> out.add(mc.getFps() + " FPS");
			case "cps" -> out.add(State.cps(0) + " | " + State.cps(1) + " CPS");
			case "coords" -> {
				if (live) {
					out.add(String.format(Locale.ROOT, "X %.1f  Y %.1f  Z %.1f", p.getX(), p.getY(), p.getZ()));
					if (m.bool("facing")) out.add("Richtung " + facing(p.getYRot()));
					if (m.bool("biome") && mc.level != null)
						out.add("Biom " + mc.level.getBiome(p.blockPosition()).unwrapKey().map(k -> pretty(k.identifier().getPath())).orElse("?"));
				} else { out.add("X 128.5  Y 64.0  Z -42.3"); out.add("Richtung Nord (-Z)"); out.add("Biom Plains"); }
			}
			case "potions" -> {
				if (live && !p.getActiveEffects().isEmpty())
					for (MobEffectInstance e : p.getActiveEffects()) {
						String name = e.getEffect().value().getDisplayName().getString();
						int lvl = e.getAmplifier() + 1;
						String time = e.isInfiniteDuration() ? "∞" : String.format(Locale.ROOT, "%d:%02d", e.getDuration() / 1200, (e.getDuration() / 20) % 60);
						out.add(name + (lvl > 1 ? " " + roman(lvl) : "") + "  " + time);
					}
				else { out.add("Stärke II  1:24"); out.add("Schnelligkeit  3:00"); }
			}
			case "ping" -> {
				int ms = -1;
				if (live && mc.getConnection() != null) { var info = mc.getConnection().getPlayerInfo(p.getUUID()); if (info != null) ms = info.getLatency(); }
				out.add(ms >= 0 && mc.getCurrentServer() != null ? ms + " ms" : preview ? "23 ms" : "Einzelspieler");
			}
			case "server" -> out.add(mc.getCurrentServer() != null ? mc.getCurrentServer().ip : "Einzelspieler");
			case "clock" -> { var t = LocalTime.now(); out.add(m.bool("seconds") ? String.format("%02d:%02d:%02d", t.getHour(), t.getMinute(), t.getSecond()) : String.format("%02d:%02d", t.getHour(), t.getMinute())); }
			case "memory" -> {
				var r = Runtime.getRuntime(); long used = r.totalMemory() - r.freeMemory(), max = r.maxMemory();
				out.add(String.format(Locale.ROOT, "RAM %d%%  %.1f/%.1f GB", used * 100 / max, used / 1073741824.0, max / 1073741824.0));
			}
			case "speed" -> {
				double v = 0;
				if (live) { var d = p.getDeltaMovement(); v = Math.sqrt(d.x * d.x + d.z * d.z) * 20; }
				out.add(String.format(Locale.ROOT, "%.2f m/s", live ? v : 5.61));
			}
			case "reach" -> out.add(String.format(Locale.ROOT, "%.2f m", State.lastReach >= 0 ? State.lastReach : 3.12));
			case "combo" -> out.add((State.combo >= 2 ? State.combo : 4) + " Combo");
			case "sprint" -> {
				if (live && p.isShiftKeyDown()) out.add("[Schleichen]");
				else out.add(mc.options.toggleSprint().get() ? "[Sprinten (umgeschaltet)]" : "[Sprinten]");
			}
			case "session" -> { long s = (System.currentTimeMillis() - State.START) / 1000; out.add(String.format("Sitzung %d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)); }
			default -> out.add(m.name);
		}
		return out;
	}

	// ---------------- keystrokes
	private static void keystrokes(GuiGraphicsExtractor g, Module m) {
		var mc = Minecraft.getInstance(); var o = mc.options;
		int s = 22, gap = 2;
		key(g, m, "W", s + gap, 0, s, s, o.keyUp.isDown());
		key(g, m, "A", 0, s + gap, s, s, o.keyLeft.isDown());
		key(g, m, "S", s + gap, s + gap, s, s, o.keyDown.isDown());
		key(g, m, "D", 2 * (s + gap), s + gap, s, s, o.keyRight.isDown());
		int y = 2 * (s + gap);
		int full = 3 * s + 2 * gap;
		if (m.bool("mouse")) {
			int w = (full - gap) / 2;
			boolean c = m.bool("cpsInKeys");
			key(g, m, c ? "LMB " + State.cps(0) : "LMB", 0, y, w, s, o.keyAttack.isDown());
			key(g, m, c ? "RMB " + State.cps(1) : "RMB", w + gap, y, full - w - gap, s, o.keyUse.isDown());
			y += s + gap;
		}
		if (m.bool("space")) key(g, m, "▬▬▬", 0, y, full, 12, o.keyJump.isDown());
	}

	private static void key(GuiGraphicsExtractor g, Module m, String label, int x, int y, int w, int h, boolean down) {
		var font = Minecraft.getInstance().font;
		g.fill(x, y, x + w, y + h, down ? (Modules.accent & 0x00FFFFFF) | 0xD0000000 : BG);
		if (down) g.fill(x, y + h - 1, x + w, y + h, Modules.accent2);
		int tc = down ? 0xFF1A0D05 : color(m, x / 4);
		g.text(font, label, x + (w - font.width(label)) / 2, y + (h - 8) / 2, tc, !down && m.bool("shadow"));
	}

	// ---------------- armor
	private static List<ItemStack> armorItems(boolean preview) {
		var p = Minecraft.getInstance().player;
		var out = new ArrayList<ItemStack>();
		if (p == null) return out;
		for (var slot : new EquipmentSlot[] { EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET }) {
			var st = p.getItemBySlot(slot);
			if (!st.isEmpty()) out.add(st);
		}
		if (Modules.get("armor").bool("hand") && !p.getMainHandItem().isEmpty()) out.add(p.getMainHandItem());
		return out;
	}

	private static void armor(GuiGraphicsExtractor g, Module m, boolean preview) {
		var font = Minecraft.getInstance().font;
		var items = armorItems(preview);
		var b = size(m, preview);
		if (m.bool("bg")) g.fill(0, 0, b.w(), b.h(), BG);
		if (items.isEmpty() && preview) { g.text(font, "Rüstung", 4, 5, color(m, 0), m.bool("shadow")); return; }
		int y = 0;
		String mode = m.get("dura");
		for (var st : items) {
			g.item(st, 1, y + 1);
			if (!mode.equals("Aus") && st.isDamageableItem()) {
				int max = st.getMaxDamage(), left = max - st.getDamageValue();
				String t = mode.equals("Zahl") ? String.valueOf(left) : (left * 100 / Math.max(1, max)) + "%";
				int pct = left * 100 / Math.max(1, max);
				int c = pct > 60 ? 0xFF4ADE9A : pct > 25 ? 0xFFFDE047 : 0xFFF87171;
				g.text(font, t, 20, y + 5, c, m.bool("shadow"));
			} else if (st.getCount() > 1) g.text(font, "x" + st.getCount(), 20, y + 5, color(m, 0), m.bool("shadow"));
			y += 18;
		}
	}

	// ---------------- helpers
	private static String facing(float yaw) {
		yaw = ((yaw % 360) + 360) % 360;
		String[] n = { "Süd (+Z)", "Südwest", "West (-X)", "Nordwest", "Nord (-Z)", "Nordost", "Ost (+X)", "Südost" };
		return n[Math.round(yaw / 45f) % 8];
	}

	private static String roman(int n) { return n <= 10 ? new String[] { "", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X" }[n] : String.valueOf(n); }

	private static String pretty(String id) {
		var sb = new StringBuilder();
		for (var w : id.split("_")) { if (w.isEmpty()) continue; sb.append(Character.toUpperCase(w.charAt(0))).append(w.substring(1)).append(' '); }
		return sb.toString().trim();
	}

	public static Font font() { return Minecraft.getInstance().font; }
}
