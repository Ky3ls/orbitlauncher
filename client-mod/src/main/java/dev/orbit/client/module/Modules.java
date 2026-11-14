package dev.orbit.client.module;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.fabricmc.loader.api.FabricLoader;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static dev.orbit.client.module.Module.Category.*;

/** All modules + config file (config/orbitclient.json, also written by OrbitLauncher). */
public final class Modules {
	public static final List<Module> ALL = new ArrayList<>();
	public static int accent = 0xFFFF7A3D, accent2 = 0xFFFFB067;
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static long lastMtime;

	private Modules() {}

	static {
		// ---- HUD (positions are fractions of the screen)
		add(new Module("fps", "FPS", "Bilder pro Sekunde", HUD, true, true, 0.006f, 0.01f));
		add(new Module("cps", "CPS", "Klicks pro Sekunde (links | rechts)", PVP, true, true, 0.006f, 0.045f));
		add(new Module("keystrokes", "Keystrokes", "WASD, Maustasten und Leertaste live", PVP, true, true, 0.006f, 0.70f)
			.setting(Setting.bool("mouse", "Maustasten", true)).setting(Setting.bool("space", "Leertaste", true)).setting(Setting.bool("cpsInKeys", "CPS in Maustasten", true)));
		add(new Module("coords", "Koordinaten", "XYZ, Blickrichtung und Biom", HUD, true, true, 0.006f, 0.08f)
			.setting(Setting.bool("biome", "Biom anzeigen", true)).setting(Setting.bool("facing", "Richtung anzeigen", true)));
		add(new Module("armor", "Rüstung", "Rüstung und Haltbarkeit", PVP, true, true, 0.94f, 0.70f)
			.setting(Setting.choice("dura", "Haltbarkeit", "Prozent", "Prozent", "Zahl", "Aus")).setting(Setting.bool("hand", "Item in der Hand", true)));
		add(new Module("potions", "Effekte", "Aktive Tränke mit Restzeit", HUD, true, true, 0.80f, 0.35f));
		add(new Module("ping", "Ping", "Latenz zum Server", HUD, true, true, 0.006f, 0.20f));
		add(new Module("server", "Server", "Aktuelle Server-Adresse", HUD, true, false, 0.006f, 0.235f));
		add(new Module("clock", "Uhrzeit", "Echte Uhrzeit", HUD, true, false, 0.90f, 0.01f)
			.setting(Setting.bool("seconds", "Sekunden", false)));
		add(new Module("memory", "Speicher", "RAM-Verbrauch von Minecraft", HUD, true, false, 0.86f, 0.045f));
		add(new Module("speed", "Tempo", "Geschwindigkeit in Blöcken pro Sekunde", HUD, true, false, 0.006f, 0.27f));
		add(new Module("reach", "Reichweite", "Distanz deines letzten Treffers", PVP, true, true, 0.45f, 0.62f));
		add(new Module("combo", "Combo", "Treffer in Folge ohne getroffen zu werden", PVP, true, true, 0.45f, 0.655f));
		add(new Module("sprint", "Sprint-Status", "Zeigt Toggle-Sprint und Schleichen", QOL, true, true, 0.006f, 0.96f));
		add(new Module("session", "Sitzung", "Spielzeit dieser Sitzung", HUD, true, false, 0.90f, 0.08f));

		// ---- features
		add(new Module("zoom", "Zoom", "Taste C halten, mit dem Mausrad Zoom ändern", PVP, false, true, 0, 0)
			.setting(Setting.number("factor", "Zoomstärke", 4, 2, 12, 1)).setting(Setting.bool("smooth", "Weicher Zoom", true))
			.setting(Setting.bool("cinematic", "Kamera glätten", true)).setting(Setting.bool("scroll", "Mausrad-Zoom", true)));
		add(new Module("freelook", "Freelook", "Linke Alt-Taste halten und frei umschauen", PVP, false, true, 0, 0)
			.setting(Setting.bool("invert", "Maus umkehren", false)));
		add(new Module("fullbright", "Fullbright", "Alles hell, auch in Höhlen (Taste G)", VISUAL, false, false, 0, 0));
		add(new Module("crosshair", "Fadenkreuz", "Eigenes Fadenkreuz statt Vanilla", VISUAL, false, false, 0, 0)
			.setting(Setting.choice("style", "Form", "Plus", "Plus", "Plus+Punkt", "Punkt", "Kreis", "X", "T"))
			.setting(Setting.number("size", "Länge", 5, 1, 15, 1)).setting(Setting.number("gap", "Abstand", 2, 0, 10, 1))
			.setting(Setting.number("thick", "Dicke", 1, 1, 4, 1))
			.setting(Setting.choice("ccolor", "Farbe", "Weiß", "Weiß", "Akzent", "Grün", "Rot", "Cyan", "Gelb", "Pink"))
			.setting(Setting.bool("outline", "Umrandung", true)));
		add(new Module("togglesprint", "Toggle Sprint", "Sprinten einmal drücken statt halten", QOL, false, true, 0, 0)
			.setting(Setting.bool("sneak", "Auch Schleichen umschalten", false)));
		add(new Module("nobob", "Ruhige Kamera", "Kein Kamerawackeln und kein FOV-Effekt", VISUAL, false, false, 0, 0));
	}

	private static void add(Module m) { ALL.add(m); }

	public static Module get(String id) { for (var m : ALL) if (m.id.equals(id)) return m; throw new IllegalArgumentException(id); }
	public static boolean on(String id) { return get(id).enabled; }

	public static Path file() { return FabricLoader.getInstance().getConfigDir().resolve("orbitclient.json"); }

	public static void load() {
		var f = file();
		try {
			if (!Files.exists(f)) { save(); return; }
			lastMtime = Files.getLastModifiedTime(f).toMillis();
			var root = JsonParser.parseString(Files.readString(f)).getAsJsonObject();
			if (root.has("accent")) { accent = hex(root.get("accent").getAsString(), accent); accent2 = lighten(accent); }
			var mods = root.has("modules") ? root.getAsJsonObject("modules") : new JsonObject();
			for (var m : ALL) {
				if (!mods.has(m.id)) continue;
				var o = mods.getAsJsonObject(m.id);
				if (o.has("enabled")) m.enabled = o.get("enabled").getAsBoolean();
				if (o.has("x") && o.has("y")) { m.x = clamp(o.get("x").getAsFloat()); m.y = clamp(o.get("y").getAsFloat()); m.placed = true; }
				if (o.has("opts")) for (Map.Entry<String, com.google.gson.JsonElement> e : o.getAsJsonObject("opts").entrySet()) m.opts.put(e.getKey(), e.getValue().getAsString());
			}
		} catch (Exception e) {
			System.err.println("[Orbit Client] Konfiguration fehlerhaft, nutze Standard: " + e);
		}
	}

	/** Reloads when the launcher changed the file while the game is running. */
	public static void reloadIfChanged() {
		try {
			var f = file();
			if (Files.exists(f) && Files.getLastModifiedTime(f).toMillis() != lastMtime) load();
		} catch (Exception ignored) {}
	}

	public static void save() {
		var root = new JsonObject();
		root.addProperty("accent", String.format("#%06X", accent & 0xFFFFFF));
		var mods = new JsonObject();
		for (var m : ALL) {
			var o = new JsonObject();
			o.addProperty("enabled", m.enabled);
			if (m.hud && m.placed) { o.addProperty("x", m.x); o.addProperty("y", m.y); }
			var opts = new JsonObject();
			for (var s : m.settings) opts.addProperty(s.key, m.get(s.key));
			o.add("opts", opts);
			mods.add(m.id, o);
		}
		root.add("modules", mods);
		try {
			Files.createDirectories(file().getParent());
			Files.writeString(file(), GSON.toJson(root));
			lastMtime = Files.getLastModifiedTime(file()).toMillis();
		} catch (Exception e) {
			System.err.println("[Orbit Client] Speichern fehlgeschlagen: " + e);
		}
	}

	private static float clamp(float v) { return Math.max(0f, Math.min(1f, v)); }

	public static int hex(String s, int def) {
		try { return 0xFF000000 | Integer.parseInt(s.replace("#", ""), 16); } catch (Exception e) { return def; }
	}

	public static int lighten(int c) {
		int r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
		r += (255 - r) * 2 / 5; g += (255 - g) * 2 / 5; b += (255 - b) * 2 / 5;
		return 0xFF000000 | r << 16 | g << 8 | b;
	}

	public static int hsv(float h, float s, float v) {
		float r, g, b; int i = (int) (h * 6) % 6; float f = h * 6 - (int) (h * 6), p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
		switch (i) { case 0 -> { r = v; g = t; b = p; } case 1 -> { r = q; g = v; b = p; } case 2 -> { r = p; g = v; b = t; }
			case 3 -> { r = p; g = q; b = v; } case 4 -> { r = t; g = p; b = v; } default -> { r = v; g = p; b = q; } }
		return 0xFF000000 | (int) (r * 255) << 16 | (int) (g * 255) << 8 | (int) (b * 255);
	}

	/** Named colors used by HUD modules and the crosshair. "Chroma" cycles through the rainbow. */
	public static int color(String name, int offset) {
		return switch (name) {
			case "Akzent" -> accent;
			case "Chroma" -> {
				float h = ((System.currentTimeMillis() + offset * 40L) % 4000L) / 4000f;
				yield hsv(h, 0.6f, 1f);
			}
			case "Grün" -> 0xFF4ADE9A;
			case "Rot" -> 0xFFF87171;
			case "Blau" -> 0xFF60A5FA;
			case "Cyan" -> 0xFF67E8F9;
			case "Gelb" -> 0xFFFDE047;
			case "Pink" -> 0xFFF472B6;
			default -> 0xFFFFFFFF;
		};
	}
}
