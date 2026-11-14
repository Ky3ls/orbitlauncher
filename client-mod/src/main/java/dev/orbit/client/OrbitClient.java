package dev.orbit.client;

import com.mojang.blaze3d.platform.InputConstants;
import dev.orbit.client.hud.Crosshair;
import dev.orbit.client.hud.Hud;
import dev.orbit.client.module.Modules;
import dev.orbit.client.ui.HudEditorScreen;
import dev.orbit.client.ui.OrbitMenuScreen;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.fabricmc.fabric.api.event.player.AttackEntityCallback;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.Identifier;
import net.minecraft.world.InteractionResult;

/** Orbit Client – the in-game part of OrbitLauncher. */
public class OrbitClient implements ClientModInitializer {
	public static final String ID = "orbitclient";
	public static KeyMapping MENU, ZOOM, FREELOOK, FULLBRIGHT;
	private static int ticks, autotestAt = -1;

	@Override
	public void onInitializeClient() {
		Modules.load();
		var cat = KeyMapping.Category.register(Identifier.fromNamespaceAndPath(ID, "main"));
		MENU = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.orbitclient.menu", InputConstants.Type.KEYBOARD, 344, cat));
		ZOOM = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.orbitclient.zoom", InputConstants.Type.KEYBOARD, 67, cat));
		FREELOOK = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.orbitclient.freelook", InputConstants.Type.KEYBOARD, 342, cat));
		FULLBRIGHT = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.orbitclient.fullbright", InputConstants.Type.KEYBOARD, 71, cat));

		HudElementRegistry.addLast(Identifier.fromNamespaceAndPath(ID, "hud"), Hud::render);
		HudElementRegistry.replaceElement(VanillaHudElements.CROSSHAIR, vanilla -> (g, dt) -> {
			if (Crosshair.active()) Crosshair.render(g); else vanilla.extractRenderState(g, dt);
		});

		AttackEntityCallback.EVENT.register((player, level, hand, entity, hit) -> {
			if (level.isClientSide() && player == Minecraft.getInstance().player) State.onAttack(player, entity);
			return InteractionResult.PASS;
		});

		ClientTickEvents.END_CLIENT_TICK.register(OrbitClient::tick);
		System.out.println("[Orbit Client] geladen – " + Modules.ALL.size() + " Module");
	}

	private static void tick(Minecraft mc) {
		ticks++;
		if (ticks % 40 == 0) Modules.reloadIfChanged();
		while (MENU.consumeClick()) if (mc.gui.screen() == null) mc.gui.setScreen(new OrbitMenuScreen(null));
		while (FULLBRIGHT.consumeClick()) { var m = Modules.get("fullbright"); m.enabled = !m.enabled; Modules.save(); }
		State.tickZoom(ZOOM.isDown());
		State.tickFreelook(FREELOOK.isDown());
		State.tickCombat();

		if (Modules.on("togglesprint")) {
			if (!mc.options.toggleSprint().get()) mc.options.toggleSprint().set(true);
			boolean sneak = Modules.get("togglesprint").bool("sneak");
			if (mc.options.toggleCrouch().get() != sneak) mc.options.toggleCrouch().set(sneak);
		}
		if (Modules.on("nobob")) {
			if (mc.options.bobView().get()) mc.options.bobView().set(false);
			if (mc.options.fovEffectScale().get() != 0.0) mc.options.fovEffectScale().set(0.0);
		}
		autotest(mc);
	}

	/** Dev only: -Dorbit.autotest=menu,settings,editor opens each screen and saves a screenshot, so the UI can be checked headless. */
	private static void autotest(Minecraft mc) {
		var spec = System.getProperty("orbit.autotest");
		if (spec == null || (mc.gui.screen() == null && mc.player == null)) return;
		if (autotestAt < 0) autotestAt = ticks + 100;
		var modes = spec.split(",");
		int rel = ticks - autotestAt;
		if (rel < 0 || rel / 80 >= modes.length) return;
		String mode = modes[rel / 80];
		if (rel % 80 == 0) {
			switch (mode) {
				case "menu" -> mc.gui.setScreen(new OrbitMenuScreen(null));
				case "settings" -> mc.gui.setScreen(new OrbitMenuScreen(null, Modules.get("crosshair")));
				case "editor" -> mc.gui.setScreen(new HudEditorScreen(null));
				default -> {}
			}
		}
		if (rel % 80 == 60) {
			net.minecraft.client.Screenshot.grab(mc.gameDirectory, mc.gameRenderer.mainRenderTarget(), c -> {});
			System.out.println("[Orbit Client] autotest screenshot " + mode);
		}
	}
}
