package dev.orbit.client.module;

import java.util.List;
import java.util.Locale;

/** A small typed option of a module (stored as string in the config, editable in the menu and in the launcher). */
public final class Setting {
	public enum Type { BOOL, CHOICE, NUMBER }

	public final String key, label, def;
	public final Type type;
	public final List<String> choices;
	public final double min, max, step;

	private Setting(String key, String label, Type type, String def, List<String> choices, double min, double max, double step) {
		this.key = key; this.label = label; this.type = type; this.def = def; this.choices = choices; this.min = min; this.max = max; this.step = step;
	}

	public static Setting bool(String key, String label, boolean def) { return new Setting(key, label, Type.BOOL, String.valueOf(def), List.of(), 0, 0, 0); }
	public static Setting choice(String key, String label, String def, String... choices) { return new Setting(key, label, Type.CHOICE, def, List.of(choices), 0, 0, 0); }
	public static Setting number(String key, String label, double def, double min, double max, double step) { return new Setting(key, label, Type.NUMBER, fmt(def), List.of(), min, max, step); }

	public static String fmt(double d) { return d == Math.rint(d) ? String.valueOf((long) d) : String.format(Locale.ROOT, "%.1f", d); }

	/** Next value when clicked (dir = +1 / -1). */
	public String next(String cur, int dir) {
		return switch (type) {
			case BOOL -> String.valueOf(!Boolean.parseBoolean(cur));
			case CHOICE -> {
				int i = Math.max(0, choices.indexOf(cur));
				yield choices.get(Math.floorMod(i + dir, choices.size()));
			}
			case NUMBER -> {
				double v;
				try { v = Double.parseDouble(cur); } catch (NumberFormatException e) { v = Double.parseDouble(def); }
				v = Math.round((v + dir * step) / step) * step;
				if (v > max + 1e-9) v = min; else if (v < min - 1e-9) v = max;
				yield fmt(v);
			}
		};
	}

	public String display(String cur) {
		return switch (type) {
			case BOOL -> Boolean.parseBoolean(cur) ? "An" : "Aus";
			case CHOICE -> cur;
			case NUMBER -> cur + (key.equals("scale") ? "x" : "");
		};
	}
}
