package dev.orbit.client.mixin;

import dev.orbit.client.State;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** While freelook is held, mouse movement turns the camera instead of the player. */
@Mixin(Entity.class)
public abstract class EntityMixin {
	@Inject(method = "turn", at = @At("HEAD"), cancellable = true)
	private void orbit$turn(double yRot, double xRot, CallbackInfo ci) {
		if (State.freelook && (Object) this == Minecraft.getInstance().player) {
			State.freelookTurn(yRot, xRot);
			ci.cancel();
		}
	}
}
