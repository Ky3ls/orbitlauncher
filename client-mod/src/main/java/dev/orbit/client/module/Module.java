package dev.orbit.client.module;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A feature of Orbit Client. HUD modules are drawn and can be dragged in the HUD editor. */
public class Module {
	public final String id;
	public final String name;
	public final String desc;
	public final Category category;
	public final boolean hud;
	public boolean enabled;
	/** Position as a fraction of the screen (0..1), so layouts survive resolution changes. */
	public float x, y;
	public final float defX, defY;
	public final boolean defEnabled;
	/** false = automatic stacked position (until the user drags the module in the HUD editor). */
	public boolean placed;
	public final Map<String, String> opts = new LinkedHashMap<>();
	public final List<Setting> settings = new ArrayList<>();

	public enum Category {
		HUD("HUD"), PVP("PvP"), VISUAL("Grafik"), QOL("Komfort");
		public final String label;
		Category(String label) { this.label = label; }
	}

	public Module(String id, String name, String desc, Category category, boolean hud, boolean enabled, float x, float y) {
		this.id = id; this.name = name; this.desc = desc; this.category = category; this.hud = hud; this.enabled = enabled; this.x = x; this.y = y; this.defX = x; this.defY = y; this.defEnabled = enabled;
		if (hud) {
			settings.add(Setting.bool("bg", "Hintergrund", true));
			settings.add(Setting.bool("shadow", "Textschatten", true));
			settings.add(Setting.choice("color", "Farbe", "Weiß", "Weiß", "Akzent", "Chroma", "Grün", "Rot", "Blau", "Gelb", "Pink"));
			settings.add(Setting.number("scale", "Größe", 1.0, 0.5, 2.5, 0.1));
		}
	}

	public Module setting(Setting s) { settings.add(s); return this; }

	public String get(String key) {
		var v = opts.get(key);
		if (v != null) return v;
		for (var s : settings) if (s.key.equals(key)) return s.def;
		return "";
	}
	public boolean bool(String key) { return Boolean.parseBoolean(get(key)); }
	public double num(String key) { try { return Double.parseDouble(get(key)); } catch (NumberFormatException e) { return 0; } }
	public void set(String key, String value) { opts.put(key, value); }

	public float scale() { return hud ? (float) Math.max(0.5, num("scale")) : 1f; }
}
