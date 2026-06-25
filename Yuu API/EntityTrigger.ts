import { Vector3 } from "./Basic Types/Vector3";
import { Entity } from "./Entity";
import { entity_Data } from "./Entity_Data";
import { Events } from "./Events";
import { Player } from "./Player";
import { registerStart } from "./RegisterStart";


registerStart(start);
function start() {
  Events.onPhysicsUpdate(onUpdate);
}

function onUpdate(deltaTime: number) {
  const entityPositionsMap = new Map<string, Vector3[]>();

  entity_Data.triggerDetectableEntities.forEach((id) => {
    const entity = Entity.getEntityByID(id);

    if (entity) {
      const tags = entity.tags.get();

      if (tags.length > 0) {
        const pos = entity.pos;

        entity.tags.get().forEach((tag) => {
          const array = entityPositionsMap.get(tag) ?? [];
          entityPositionsMap.set(tag, array);

          array.push(pos);
        });
      }
    }
  });

  const headPos = Player.head.position.get() ?? Vector3.zero;
  const bodyPos = Player.body.position.get() ?? Vector3.zero;
  const leftHandPos = Player.leftHand.position.get() ?? Vector3.zero;
  const rightHandPos = Player.rightHand.position.get() ?? Vector3.zero;
  const footPos = Player.foot.position.get() ?? Vector3.zero;

  entity_Data.triggerMap.forEach((payload, entityNodeID) => {
    // Current Sphere / Cylinder triggers only work upright
    // Need Cube triggers with directions badly

    // We need the callback function to return the WhatCanTrigger type and the Entity if it is an Entity

    // Is this necessary if we make sure that deleting the entity deletes the trigger?

    const entity = Entity.getEntityByID(entityNodeID);

    if (entity) {
      const entityPos = entity.pos;

      let parent = entity.parent;

      // This is way overkill for a static trigger, definitely shouldn't do this on update if it isn't animated
      while (parent) {
        entityPos.addInPlace(parent.pos);

        parent = parent.parent;
      }

      let didTrigger = false;
      const positions: Vector3[] = [];

      const checkPositions: Vector3[] = [];

      if (payload.whatCanTrigger.includes('Body')) {
        checkPositions.push(bodyPos);
      }

      if (payload.whatCanTrigger.includes('Entity')) {
        payload.entityTags.forEach((tag) => {
          const tagPosArray = entityPositionsMap.get(tag);

          if (tagPosArray) {
            tagPosArray.forEach((pos) => {
              if (!checkPositions.includes(pos)) {
                checkPositions.push(pos);
              }
            });
          }
        });
      }

      if (payload.whatCanTrigger.includes('Foot')) {
        checkPositions.push(footPos);
      }

      if (payload.whatCanTrigger.includes('Head')) {
        checkPositions.push(headPos);
      }

      if (payload.whatCanTrigger.includes('Left Hand')) {
        checkPositions.push(leftHandPos);
      }

      if (payload.whatCanTrigger.includes('Right Hand')) {
        checkPositions.push(rightHandPos);
      }

      checkPositions.forEach((pos) => {
        let isInTrigger = false;

        if (payload.yRadius === undefined) {
          isInTrigger = entityPos.distanceTo(pos) < payload.triggerRadius;
        }
        else {
          const distVec = entityPos.subtract(pos);

          if (Math.abs(distVec.y) < payload.yRadius) {
            if (((distVec.x * distVec.x) + (distVec.z * distVec.z)) < (payload.triggerRadius * payload.triggerRadius)) {
              isInTrigger = true;
            }
          }
        }

        if (isInTrigger) {
          payload.activeCount++;
          didTrigger = true;
          [positions.push(pos)];

          if (payload.activeCount === 1) {
            if (payload.occupiedTriggeredFunction) {
              payload.occupiedTriggeredFunction({ pos: pos });
            }
          }
        }
      });

      if (didTrigger) {
        if (payload.onUpdateTriggeredFunction) {
          payload.onUpdateTriggeredFunction({ positions: positions });
        }
      }
      else {
        if (payload.activeCount > 0) {
          payload.activeCount = 0;

          if (payload.emptyTriggeredFunction) {
            payload.emptyTriggeredFunction();
          }
        }
      }
    }
  });
}
