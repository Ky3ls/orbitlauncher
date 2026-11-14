package dev.orbit.client;

import dev.orbit.client.module.Modules;
import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;

import java.util.ArrayDeque;

/** Runtime state shared between modules, mixins and the HUD. */
public final class State {
	private State() {}

	// ---------------- CPS
	private static final ArrayDeque<Long> LEFT = new ArrayDeque<>(), RIGHT = new ArrayDeque<>();
	public static void click(int button) {
		var q = button == 0 ? LEFT : button == 1 ? RIGHT : null;
		if (q == null) return;
		synchronized (q) { q.addLast(System.currentTimeMillis()); }
	}
	public static int cps(int button) {
		var q = button == 0 ? LEFT : RIGHT;
		long now = System.currentTimeMillis();
		synchronized (q) { while (!q.isEmpty() && now - q.peekFirst() > 1000) q.pollFirst(); return q.size(); }
	}

	// ---------------- Zoom
	public static boolean zoomHeld;
	public static double zoomFactor = -1;     // current wheel-adjusted factor, -1 = use config
	private static double zoomCur = 1;
	private static long zoomLast = System.nanoTime();
	private static Boolean savedSmooth;

	/** Divisor applied to the FOV (1 = no zoom). Smoothly animated per frame. */
	public static float zoomDivisor() {
		var m = Modules.get("zoom");
		double target = m.enabled && zoomHeld ? (zoomFactor > 0 ? zoomFactor : m.num("factor")) : 1;
		long now = System.nanoTime();
		double dt = Math.min(0.1, (now - zoomLast) / 1e9);
		zoomLast = now;
		if (!m.bool("smooth")) zoomCur = target;
		else zoomCur += (target - zoomCur) * (1 - Math.exp(-dt * 14));
		if (Math.abs(zoomCur - target) < 0.002) zoomCur = target;
		return (float) zoomCur;
	}

	public static void tickZoom(boolean held) {
		var mc = Minecraft.getInstance();
		var m = Modules.get("zoom");
		boolean active = held && m.enabled && mc.gui.screen() == null;
		if (active && !zoomHeld) {
			zoomFactor = -1;
			if (m.bool("cinematic")) { savedSmooth = mc.options.smoothCamera; mc.options.smoothCamera = true; }
		} else if (!active && zoomHeld && savedSmooth != null) { mc.options.smoothCamera = savedSmooth; savedSmooth = null; }
		zoomHeld = active;
	}

	/** Mouse wheel while zooming changes the zoom. Returns true if the scroll was consumed. */
	public static boolean scrollZoom(double amount) {
		var m = Modules.get("zoom");
		if (!zoomHeld || !m.bool("scroll") || amount == 0) return false;
		double f = zoomFactor > 0 ? zoomFactor : m.num("factor");
		zoomFactor = Math.max(1.5, Math.min(50, f * (amount > 0 ? 1.25 : 0.8)));
		return true;
	}

	// ---------------- Freelook
	public static boolean freelook;
	public static float lookYaw, lookPitch;
	private static CameraType savedCamera;

	public static void tickFreelook(boolean held) {
		var mc = Minecraft.getInstance();
		boolean want = held && Modules.on("freelook") && mc.player != null && mc.gui.screen() == null;
		if (want && !freelook) {
			lookYaw = mc.player.getYRot(); lookPitch = mc.player.getXRot();
			savedCamera = mc.options.getCameraType();
			if (savedCamera.isFirstPerson()) mc.options.setCameraType(CameraType.THIRD_PERSON_BACK);
			freelook = true;
		} else if (!want && freelook) {
			freelook = false;
			if (savedCamera != null) mc.options.setCameraType(savedCamera);
		}
	}

	public static void freelookTurn(double dYaw, double dPitch) {
		boolean inv = Modules.get("freelook").bool("invert");
		lookYaw += (float) dYaw * 0.15f;
		lookPitch = Math.max(-90f, Math.min(90f, lookPitch + (float) (inv ? -dPitch : dPitch) * 0.15f));
	}

	// ---------------- Reach & combo
	public static double lastReach = -1;
	public static long lastReachAt;
	public static int combo;
	private static long comboAt;
	private static int lastHurt;

	public static void onAttack(Player p, Entity target) {
		var e = p.getEyePosition(); var bb = target.getBoundingBox();
		double dx = Math.max(Math.max(bb.minX - e.x, 0), e.x - bb.maxX);
		double dy = Math.max(Math.max(bb.minY - e.y, 0), e.y - bb.maxY);
		double dz = Math.max(Math.max(bb.minZ - e.z, 0), e.z - bb.maxZ);
		lastReach = Math.sqrt(dx * dx + dy * dy + dz * dz);
		lastReachAt = System.currentTimeMillis();
		combo++; comboAt = lastReachAt;
	}

	public static void tickCombat() {
		var p = Minecraft.getInstance().player;
		if (p == null) { combo = 0; return; }
		if (p.hurtTime > lastHurt) combo = 0;   // got hit
		lastHurt = p.hurtTime;
		if (combo > 0 && System.currentTimeMillis() - comboAt > 2500) combo = 0;
	}

	// ---------------- session
	public static final long START = System.currentTimeMillis();
}
