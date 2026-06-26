import { arrayUtils } from "./ArrayUtils";
import { Color } from "./Basic Types/Color";
import { Quaternion } from "./Basic Types/Quaternion";
import { Vector2 } from "./Basic Types/Vector2";
import { Vector3 } from "./Basic Types/Vector3";
import { RayHit } from "./Raycast";
import { Texture } from "./Texture";
import { spawnPrimitive } from "./SpawnPrimitive";
import { entity_Data, OccupiedTriggerPayload, OnUpdatePayload, WhatCanTrigger } from "./Entity_Data";


/**
 * The Entity class creates an empty node, and has methods for adding and interacting with child nodes
 */
export class Entity {
  public nodeID: number | undefined;
  public type: BaseNodeTypes | undefined;
  private childNodeIDs: number[] = [];

  public parent: Entity | undefined;
  public childEntities: Entity[] = [];

  private _pos: Vector3 = Vector3.zero;
  private _rot: Quaternion = Quaternion.one;
  private _scale: Vector3 = Vector3.one;

  set pos(position: Vector3) {
    if (this.nodeID && this.nodeID !== -1) {
      this._pos = position;

      Godot.node.transform.position.set(this.nodeID, position.x, position.y, position.z);
    }
  }

  get pos(): Vector3 {
    if (this.nodeID && this.nodeID !== -1) {
      const godotVec3 = Godot.node.transform.position.get(this.nodeID);

      if (godotVec3) {
        this._pos = new Vector3(godotVec3.x, godotVec3.y, godotVec3.z);
      }
    }

    return this._pos;
  }

  set rot(rotation: Quaternion) {
    if (this.nodeID && this.nodeID !== -1) {
      this._rot = rotation;

      Godot.node.transform.rotation.set(this.nodeID, rotation.x, rotation.y, rotation.z, rotation.w);
    }
  }

  get rot(): Quaternion {
    if (this.nodeID && this.nodeID !== -1) {
      const godotQuaternion = Godot.node.transform.rotation.get(this.nodeID);

      if (godotQuaternion) {
        this._rot = new Quaternion(godotQuaternion.x, godotQuaternion.y, godotQuaternion.z, godotQuaternion.w);
      }
    }

    return this._rot;
  }

  set scale(scaleValue: Vector3) {
    if (this.nodeID && this.nodeID !== -1) {
      this._scale = scaleValue;
      // This presently does not affect any children, oops...

      if (this.mesh.nodeID) {
        Godot.node.transform.scale.set(this.mesh.nodeID, scaleValue.x, scaleValue.y, scaleValue.z);
      }

      if (this.collider.nodeID) {
        Godot.node.transform.scale.set(this.collider.nodeID, scaleValue.x, scaleValue.y, scaleValue.z);
      }
    }
  }

  get scale(): Vector3 {
    if (this.nodeID && this.nodeID !== -1) {
      const idToUse = this.mesh.nodeID ? this.mesh.nodeID : this.collider.nodeID;

      if (idToUse) {
        const godotVec3 = Godot.node.transform.scale.get(idToUse);

        if (godotVec3) {
          this._scale = new Vector3(godotVec3.x, godotVec3.y, godotVec3.z);
        }
      }
    }

    return this._scale;
  }

  get forward(): Vector3 {
    if (this.nodeID && this.nodeID !== -1) {
      const godotVec3 = Godot.node.transform.forward.get(this.nodeID);

      if (godotVec3) {
        return new Vector3(godotVec3.x, godotVec3.y, godotVec3.z);
      }
    }

    return Vector3.zero;
  }

  get up(): Vector3 {
    if (this.nodeID && this.nodeID !== -1) {
      const godotVec3 = Godot.node.transform.up.get(this.nodeID);

      if (godotVec3) {
        return new Vector3(godotVec3.x, godotVec3.y, godotVec3.z);
      }
    }

    return Vector3.zero;
  }

  get right(): Vector3 {
    if (this.nodeID && this.nodeID !== -1) {
      const godotVec3 = Godot.node.transform.right.get(this.nodeID);

      if (godotVec3) {
        return new Vector3(godotVec3.x, godotVec3.y, godotVec3.z);
      }
    }

    return Vector3.zero;
  }

  private _tags: string[] = [];

  tags = {
    add: (tag: string) => {
      if (!this._tags.includes(tag)) {
        this._tags.push(tag);
      }
    },
    remove: (tag: string) => {
      arrayUtils.removeItemFromArray(this._tags, tag);
    },
    get: (): string[] => {
      return [...this._tags];
    },
    clear: () => {
      this._tags.length = 0;
    },
  }

  /**
   * Create a new entity, a helper class in the Slumber Party API for working with various node types.
   * @param pos to create the entity at
   * @param rot to start at
   * @param scale to start at
   * @param parent if the entity should be a child
   * @param type of the entity, used for defining animation
   */
  constructor(pos: Vector3, rot: Quaternion, scale: Vector3, parent: Entity | undefined, type: BaseNodeTypes) {
    this.nodeID = Godot.node.create.base(parent?.nodeID, type);

    if (this.nodeID) {
      Entity.entityMap.set(this.nodeID, this);
    }

    this.type = type;

    parent?.addChildEntity(this, true);

    this.pos = pos;
    this.rot = rot;
    this.scale = scale;
  }

  velocity = {
    set: (vel: Vector3) => {
      if (this.nodeID && this.type === 'Physics') {
        Godot.node.velocity.set(this.nodeID, vel.x, vel.y, vel.z);
      }
    },

    /**
     * Get the current velocity
     * @returns velocity or undefined if the entity is not a physics entity
     */
    get: (): Vector3 | undefined => {
      if (this.nodeID && this.type === 'Physics') {
        const vel = Godot.node.velocity.get(this.nodeID);

        if (vel) {
          return new Vector3(vel.x, vel.y, vel.z)
        }
        else {
          return undefined;
        }
      }
      else {
        return undefined;
      }
    },
  }

  changeType(type: BaseNodeTypes) {
    if (this.nodeID) {
      this.type = type;
      this.nodeID = Godot.node.changeType(this.nodeID, type) ?? this.nodeID;
    }
  }

  /**
   * Destroys the Entity and all its children
   */
  destroy() {
    if (this.nodeID) {
      [...this.childEntities].forEach((entity) => {
        entity.destroy();
      });

      this.childNodeIDs.forEach((id) => {
        Godot.node.destroy(id);
      });

      this.parent?.removeChildEntity(this, true);
      Godot.node.destroy(this.nodeID);

      Entity.entityMap.delete(this.nodeID);
      this.nodeID = undefined;
      this.type = undefined;
      this.childEntities = [];
      this.childNodeIDs = [];
      this.mesh.nodeID = undefined;
      this.collider.nodeID = undefined;
      this.triggerMeshEntity = undefined;
      this.texture = undefined;
      entity_Data.triggerMap.delete(this.nodeID ?? -1);
      entity_Data.rayClickMap.delete(this.nodeID ?? -1);
      arrayUtils.removeItemFromArray(entity_Data.paintableEntities, this.nodeID);
      arrayUtils.removeItemFromArray(entity_Data.uvEntities, this.nodeID);
    }
  }

  /**
   * Check if an entity exists and has not been destroyed
   * @returns true if the nodeID is not undefined
   */
  exists(): boolean {
    if (this.nodeID) {
      return true;
    }
    else {
      return false;
    }
  }

  addChildEntity(child: Entity, calledByConstructor: boolean = false) {
    if (this.nodeID) {
      if (child.parent === undefined) {
        child.parent = this;

        if (!this.childEntities.includes(child)) {
          this.childEntities.push(child);
        }
      }

      if (!calledByConstructor) {
        // Needs a new C++ function to move a node inside a parent node
      }
    }
  }

  removeChildEntity(child: Entity, calledByDestroy: boolean = false) {
    if (this.nodeID) {
      if (child.parent === this) {
        if (this.childEntities.includes(child)) {
          arrayUtils.removeItemFromArray(this.childEntities, child);
        }
      }

      if (!calledByDestroy) {
        // Needs a new C++ function to remove a node from inside a parent node (place it outside on the root level)
      }
    }
  }

  visible = {
    set: (isVisible: boolean) => {
      if (this.nodeID) {
        Godot.node.visible.set(this.nodeID, isVisible);
      }
    },

    get: (): boolean | undefined => {
      if (this.nodeID) {
        return Godot.node.visible.get(this.nodeID);
      }
      else {
        return undefined;
      }
    },
  }

  collidable = {
    set: (isCollidable: boolean) => {
      if (this.collider.nodeID) {
        Godot.node.collidable.set(this.collider.nodeID, isCollidable);
      }

      this.childEntities.forEach((child) => {
        child.collidable.set(isCollidable);
      });
    },

    get: (): boolean | undefined => {
      if (this.collider.nodeID) {
        return Godot.node.collidable.get(this.collider.nodeID);
      }
      else {
        return undefined;
      }
    },
  }

  private meshColor: undefined | { color: Color, alpha: number } = undefined;
  private useMipMaps: boolean = false;
  private drawMode: 'Linear' | 'NearestNeighbor' = 'Linear';
  private texture: Texture | undefined;


  mesh = {
    nodeID: undefined as number | undefined,

    create: (verts: Vector3[], uvs: Vector2[], triangles: number[]) => {
      if (this.nodeID) {
        this.mesh.destroy();

        const vertsPacked = new Float32Array(verts.length * 3);
        const uvsPacked = new Float32Array(uvs.length * 2);
        const trianglesPacked = new Int32Array(triangles);

        for (let i = 0; i < verts.length; i++) {
          vertsPacked[i * 3] = verts[i].x;
          vertsPacked[(i * 3) + 1] = verts[i].y;
          vertsPacked[(i * 3) + 2] = verts[i].z;
        }

        for (let i = 0; i < uvs.length; i++) {
          uvsPacked[i * 2] = uvs[i].x;
          uvsPacked[(i * 2) + 1] = uvs[i].y;
        }

        this.mesh.nodeID = Godot.node.create.mesh(this.nodeID, vertsPacked, uvsPacked, trianglesPacked);

        if (this.mesh.nodeID) {
          this.childNodeIDs.push(this.mesh.nodeID);
        }

        if (this.meshColor) {
          this.mesh.color.set(this.meshColor.color, this.meshColor.alpha);
        }

        this.scale = this.scale;
      }
    },

    // update: () => {
    //   // Create is not ideal to call every frame.
    //   // For modifying verts every frame we will want to use Arrays stored outside of the function call,
    //   // and only recreate the arrays when adding or deleting a vert.
    //   // We may also want to create a better utility for modifying meshes on the Godot C++ side.
    // },

    color: {
      /**
       * Updates the mesh material tint and color, 
       * @param color to be used
       * @param alpha below 1 is transparent, if set to 1 it is fully opaque (use sparingly)
       */
      set: (color: Color, alpha: number) => {
        if (this.nodeID) {
          this.meshColor = { color: color, alpha: alpha };

          if (this.mesh.nodeID) {
            Godot.node.material.tintColor.set(this.mesh.nodeID, color.r, color.g, color.b, alpha);
          }
        }
      },

      get: (): { color: Color, alpha: number } | undefined => {
        return this.meshColor;
      }
    },

    texture: {
      set: (texture: Texture, useMipMaps: boolean) => {
        if (this.nodeID && this.mesh.nodeID && texture.imageID !== -1) {
          this.texture = texture;
          this.useMipMaps = useMipMaps;

          Godot.image.applyAsTextureToMesh(this.mesh.nodeID, texture.imageID);

          if (useMipMaps) {
            texture.updateMipMaps();
          }
          else {
            this.mesh.texture.setDrawMode(this.drawMode);
          }
        }
      },

      get: (): Texture | undefined => {
        return this.texture;
      },

      setMipMaps: (enabled: boolean) => {
        if (enabled !== this.useMipMaps) {
          this.useMipMaps = enabled;

          this.mesh.texture.setDrawMode(this.drawMode);
        }
      },

      setDrawMode: (mode: 'Linear' | 'NearestNeighbor') => {
        if (this.nodeID !== -1 && this.mesh.nodeID) {
          Godot.node.material.setTextureDrawMode(this.mesh.nodeID, mode, this.useMipMaps);

          this.drawMode = mode;
        }
      },

      /**
       * Allows a mesh texture to be painted by the default painting tools using the UV coordinates of a **concave** mesh collider
       */
      isPaintable: {
        set: (isPaintable: boolean) => {
          if (this.nodeID) {
            if (isPaintable) {
              if (!entity_Data.paintableEntities.includes(this.nodeID ?? -1)) {
                entity_Data.paintableEntities.push(this.nodeID ?? -1);

                this.rayClick.initialize(true);
              }
            }
            else {
              arrayUtils.removeItemFromArray(entity_Data.paintableEntities, this.nodeID ?? -1);
            }
          }
        },
        get: (): boolean => {
          return entity_Data.paintableEntities.includes(this.nodeID ?? -1);
        },
      },
    },

    material: {

      /**
         * Adjust the color of the material
         */
      tintColor: {
        /**
         * Tint a material, any alpha lower than 1 will change the material to transparent
         * @param id of the node to affect
         * @param color to use
         * @param alpha 1 is solid, anything less is transparent
         * @returns boolean true if successful
         */
        set: (color: Color, alpha: number) => {
          if (this.nodeID && this.mesh.nodeID) {
            Godot.node.material.tintColor.set(this.mesh.nodeID, color.r, color.g, color.b, alpha);
          }
        },

        get: (): ({ color: Color, alpha: number } | undefined) => {
          if (this.nodeID && this.mesh.nodeID) {
            const payload = Godot.node.material.tintColor.get(this.mesh.nodeID);

            if (payload) {
              return { color: new Color(payload.r, payload.g, payload.b), alpha: payload.a };
            }
            else {
              return undefined;
            }
          }
          else {
            return undefined;
          }
        },
      },

      /**
       * Change the emission color of a mesh node
       */
      emissionColor: {
        /**
         * Sets the emission color for a mesh, the color black disables emission
         * @param id of the mesh node
         * @param color to use
         * @returns boolean true if successful
         */
        set: (color: Color) => {
          if (this.nodeID && this.mesh.nodeID) {
            Godot.node.material.emissionColor.set(this.mesh.nodeID, color.r, color.g, color.b);
          }
        },

        get: (): (Color | undefined) => {
          if (this.nodeID && this.mesh.nodeID) {
            const payload = Godot.node.material.emissionColor.get(this.mesh.nodeID);

            if (payload) {
              return new Color(payload.r, payload.g, payload.b);
            }
            else {
              return undefined;
            }
          }
          else {
            return undefined;
          }
        },
      },
      /**
       * Change the emission strength of a mesh node
       */
      emissionStrength: {
        set: (strength: number) => {
          if (this.nodeID && this.mesh.nodeID) {
            Godot.node.material.emissionStrength.set(this.mesh.nodeID, strength);
          }
        },

        get: (): (number | undefined) => {
          if (this.nodeID && this.mesh.nodeID) {
            return Godot.node.material.emissionStrength.get(this.mesh.nodeID);
          }
          else {
            return undefined;
          }
        },
      },

      /**
       * The roughness of a mesh node, 0 none, 1 max
       */
      roughness: {
        set: (strength: number) => {
          if (this.nodeID && this.mesh.nodeID) {
            Godot.node.material.roughness.set(this.mesh.nodeID, strength);
          }
        },

        get: (): (number | undefined) => {
          if (this.nodeID && this.mesh.nodeID) {
            return Godot.node.material.roughness.get(this.mesh.nodeID);
          }
          else {
            return undefined;
          }
        },
      },

      /**
       * The metallic strength of a mesh node, 0 none, 1 max
       */
      metallic: {
        set: (strength: number) => {
          if (this.nodeID && this.mesh.nodeID) {
            Godot.node.material.metallic.set(this.mesh.nodeID, strength);
          }
        },

        get: (): (number | undefined) => {
          if (this.nodeID && this.mesh.nodeID) {
            return Godot.node.material.metallic.get(this.mesh.nodeID);
          }
          else {
            return undefined;
          }
        },
      },
    },

    destroy: () => {
      if (this.nodeID) {
        destroy(this.mesh.nodeID, this.childNodeIDs);
        this.mesh.nodeID = undefined;
        this.meshColor = undefined;
      }
    },
  }

  collider = {
    nodeID: undefined as number | undefined,

    createFromMeshNode: (meshNodeID: number, type: ColliderTypes) => {
      if (this.nodeID) {
        this.collider.destroy();

        this.collider.nodeID = Godot.node.create.collider.fromMeshNode(this.nodeID, meshNodeID, type);

        this.createColliderFinalSteps();
      }
    },

    createSphere: (radius: number) => {
      if (this.nodeID) {
        this.collider.destroy();

        this.collider.nodeID = Godot.node.create.collider.sphere(this.nodeID, radius);

        this.createColliderFinalSteps();
      }
    },

    createCylinder: (radius: number, height: number) => {
      if (this.nodeID) {
        this.collider.destroy();

        this.collider.nodeID = Godot.node.create.collider.cylinder(this.nodeID, radius, height);

        this.createColliderFinalSteps();
      }
    },

    createCapsule: (radius: number, height: number) => {
      if (this.nodeID) {
        this.collider.destroy();

        this.collider.nodeID = Godot.node.create.collider.capsule(this.nodeID, radius, height);

        this.createColliderFinalSteps();
      }
    },

    createBox: (scale: Vector3) => {
      if (this.nodeID) {
        this.collider.destroy();

        this.collider.nodeID = Godot.node.create.collider.box(this.nodeID, scale.x, scale.y, scale.z);

        this.createColliderFinalSteps();
      }
    },

    destroy: () => {
      if (this.nodeID) {
        destroy(this.collider.nodeID, this.childNodeIDs);
        this.collider.nodeID = undefined;
      }
    },
  }

  private createColliderFinalSteps() {
    if (this.collider.nodeID) {
      this.childNodeIDs.push(this.collider.nodeID);
    }

    this.scale = this.scale;
  }

  private triggerMeshEntity: Entity | undefined;

  trigger = {
    /**
     * get and set whether or not a trigger can detect this entity
     */
    isTracked: {
      /**
       * Set whether or not a trigger can detect this entity
       * @param isTracked boolean true will allow triggers to detect this entity
       */
      set: (isTracked: boolean) => {
        if (this.nodeID) {
          if (isTracked) {
            if (!entity_Data.triggerDetectableEntities.includes(this.nodeID)) {
              entity_Data.triggerDetectableEntities.push(this.nodeID);
            }
          }
          else {
            arrayUtils.removeItemFromArray(entity_Data.triggerDetectableEntities, this.nodeID);
          }
        }
      },
      
      /**
       * Get whether or not a trigger can detect this entity
       * @returns boolean true if triggers can detect this entity
       */
      get: (): boolean => {
        if (this.nodeID) {
          return entity_Data.triggerDetectableEntities.includes(this.nodeID);
        }
        else {
          return false;
        }
      },
    },

    /**
     * Creates a trigger on the entity, so that it can detect things within its bubble
     * @param triggerRadius to detect within
     * @param yRadius allows for custom height on the trigger
     * @param whatCanTrigger allows you to specify what causes the trigger to fire
     * @param entityTags if detecting entities, they need to have isTracked set to true and have a matching tag to be detected
     */
    initialize: (triggerRadius: number, yRadius: number | undefined, whatCanTrigger: WhatCanTrigger[], entityTags: string[] | undefined) => {
      if (this.nodeID) {
        entity_Data.triggerMap.set(this.nodeID ?? -1, { triggerRadius: triggerRadius, yRadius: yRadius, whatCanTrigger: whatCanTrigger, entityTags: entityTags ?? [], activeCount: 0, onUpdateTriggeredFunction: undefined, occupiedTriggeredFunction: undefined, emptyTriggeredFunction: undefined });
      }
    },

    delete: () => {
      if (this.nodeID) {
        entity_Data.triggerMap.delete(this.nodeID ?? -1);
        this.trigger.setVisible(false, undefined);
      }
    },

    setOnUpdateFunction: (func: (payload: OnUpdatePayload) => void) => {
      if (this.nodeID) {
        const data = entity_Data.triggerMap.get(this.nodeID ?? -1);

        if (data) {
          data.onUpdateTriggeredFunction = func;
        }
      }
    },

    clearOnUpdateFunction: () => {
      if (this.nodeID) {
        const data = entity_Data.triggerMap.get(this.nodeID ?? -1);

        if (data) {
          data.onUpdateTriggeredFunction = undefined;
        }
      }
    },

    setOccupiedFunction: (func: (payload: OccupiedTriggerPayload) => void) => {
      if (this.nodeID) {
        const data = entity_Data.triggerMap.get(this.nodeID ?? -1);

        if (data) {
          data.occupiedTriggeredFunction = func;
        }
      }
    },

    clearOccupiedFunction: () => {
      if (this.nodeID) {
        const data = entity_Data.triggerMap.get(this.nodeID ?? -1);

        if (data) {
          data.occupiedTriggeredFunction = undefined;
        }
      }
    },

    setEmptyFunction: (func: () => void) => {
      if (this.nodeID) {
        const data = entity_Data.triggerMap.get(this.nodeID ?? -1);

        if (data) {
          data.emptyTriggeredFunction = func;
        }
      }
    },

    clearEmptyFunction: () => {
      if (this.nodeID) {
        const data = entity_Data.triggerMap.get(this.nodeID ?? -1);

        if (data) {
          data.emptyTriggeredFunction = undefined;
        }
      }
    },

    setVisible: (isVisible: boolean, color: Color | undefined) => {
      // Use correct shape ie. cylinder or box
      if (this.nodeID) {
        if (!isVisible) {
          this.triggerMeshEntity?.destroy();
        }
        else {
          if (this.triggerMeshEntity) {
            this.triggerMeshEntity.destroy();
          }

          const data = entity_Data.triggerMap.get(this.nodeID ?? -1);

          if (data) {
            this.triggerMeshEntity = spawnPrimitive.sphere(16, 16, Vector3.zero, (data.triggerRadius * 2), Quaternion.one, color ?? Color.green, 0.25, 'None', 'Empty', this);
          }
        }
      }
    },
  }

  rayClick = {
    /**
     * Initialize an entity to become ray clickable. **Must Have Collider** 
     * @param getUVs in the rayHit, needs to be a concave mesh entity
     */
    initialize: (getUVs: boolean) => {
      if (this.nodeID) {
        if (!entity_Data.rayClickMap.has(this.nodeID ?? -1)) {
          entity_Data.rayClickMap.set(this.nodeID, { clickFunction: undefined, heldFunction: undefined, releaseFunction: undefined });
        }

        if (getUVs) {
          if (!entity_Data.uvEntities.includes(this.nodeID ?? -1)) {
            entity_Data.uvEntities.push(this.nodeID ?? -1);
          }
        }
      }
    },

    /**
     * Removes the ability for the entity to be clicked by a ray and deletes all stored callback functions
     */
    remove: () => {
      if (this.nodeID) {
        entity_Data.rayClickMap.delete(this.nodeID ?? -1);
        arrayUtils.removeItemFromArray(entity_Data.uvEntities, this.nodeID ?? -1);
      }
    },

    setClickFunction: (func: (payload: RayHit) => void) => {
      if (this.nodeID) {
        const data = entity_Data.rayClickMap.get(this.nodeID ?? -1);

        if (data) {
          data.clickFunction = func;
        }
      }
    },

    clearClickFunction: () => {
      if (this.nodeID) {
        const data = entity_Data.rayClickMap.get(this.nodeID ?? -1);

        if (data) {
          data.clickFunction = undefined;
        }
      }
    },

    setHeldFunction: (func: (payload: RayHit) => void) => {
      if (this.nodeID) {
        const data = entity_Data.rayClickMap.get(this.nodeID ?? -1);

        if (data) {
          data.heldFunction = func;
        }
      }
    },

    clearHeldFunction: () => {
      if (this.nodeID) {
        const data = entity_Data.rayClickMap.get(this.nodeID ?? -1);

        if (data) {
          data.heldFunction = undefined;
        }
      }
    },

    setReleaseFunction: (func: () => void) => {
      if (this.nodeID) {
        const data = entity_Data.rayClickMap.get(this.nodeID ?? -1);

        if (data) {
          data.releaseFunction = func;
        }
      }
    },

    clearReleaseFunction: () => {
      if (this.nodeID) {
        const data = entity_Data.rayClickMap.get(this.nodeID ?? -1);

        if (data) {
          data.releaseFunction = undefined;
        }
      }
    },
  }

  text = {
    nodeID: undefined as number | undefined,

    /**
     * Creates a text node
     * @param text to be displayed
     * @param fontSize to be used, ie. 40
     * @param outlineSize to be used, (int, ie. 0, 1, 2+)
     */
    create: (text: string, fontSize: number, outlineSize: number) => {
      if (this.nodeID) {
        this.text.nodeID = Godot.node.create.text(this.nodeID, text, fontSize, outlineSize);
      }
    },

    display: {
      set: (text: string) => {
        if (this.nodeID && this.text.nodeID) {
          Godot.node.text.display.set(this.text.nodeID, text);
        }
      },
      get: (): string | undefined => {
        if (this.nodeID && this.text.nodeID) {
          return Godot.node.text.display.get(this.text.nodeID);
        }
        else {
          return undefined;
        }
      },
    },
    fontSize: {
      set: (size: number) => {
        if (this.nodeID && this.text.nodeID) {
          Godot.node.text.fontSize.set(this.text.nodeID, size);
        }
      },
      get: (): number | undefined => {
        if (this.nodeID && this.text.nodeID) {
          return Godot.node.text.fontSize.get(this.text.nodeID);
        }
        else {
          return undefined;
        }
      },
    },
    color: {
      set: (color: Color) => {
        if (this.nodeID && this.text.nodeID) {
          Godot.node.text.color.set(this.text.nodeID, color.r, color.g, color.b);
        }
      },
      get: (): Color | undefined => {
        if (this.nodeID && this.text.nodeID) {
          const payload = Godot.node.text.color.get(this.text.nodeID);

          if (payload) {
            return new Color(payload.r, payload.g, payload.b);
          }
          else {
            return undefined;
          }
        }
        else {
          return undefined;
        }
      },
    },
    outline: {
      /**
       * Adjust the outline size of a text node
       * @param size of the outline (int values, ie. 0, 1, 2+)
       */
      set: (size: number) => {
        if (this.nodeID && this.text.nodeID) {
          Godot.node.text.outline.set(this.text.nodeID, size);
        }
      },
      get: (): number | undefined => {
        if (this.nodeID && this.text.nodeID) {
          return Godot.node.text.outline.get(this.text.nodeID);
        }
        else {
          return undefined;
        }
      },

      color: {
        set: (color: Color) => {
          if (this.nodeID && this.text.nodeID) {
            Godot.node.text.outline.color.set(this.text.nodeID, color.r, color.g, color.b);
          }
        },
        get: (): Color | undefined => {
          if (this.nodeID && this.text.nodeID) {
            const payload = Godot.node.text.outline.color.get(this.text.nodeID);

            if (payload) {
              return new Color(payload.r, payload.g, payload.b);
            }
            else {
              return undefined;
            }
          }
          else {
            return undefined;
          }
        },
      },
    },

    doubleSided: {
      set: (isDoubleSided: boolean) => {
        if (this.nodeID && this.text.nodeID) {
          Godot.node.text.doubleSided.set(this.text.nodeID, isDoubleSided);
        }
      },
      get: (): boolean | undefined => {
        if (this.nodeID && this.text.nodeID) {
          return Godot.node.text.doubleSided.get(this.text.nodeID);
        }
        else {
          return undefined;
        }
      }
    },

    billboard: {
      set: (isEnabled: boolean) => {
        if (this.nodeID && this.text.nodeID) {
          Godot.node.text.billboard.set(this.text.nodeID, isEnabled);
        }
      },
      get: (): boolean | undefined => {
        if (this.nodeID && this.text.nodeID) {
          return Godot.node.text.billboard.get(this.text.nodeID);
        }
        else {
          return undefined;
        }
      }
    },

    destroy: () => {
      if (this.nodeID) {
        destroy(this.text.nodeID, this.childNodeIDs);
        this.text.nodeID = undefined;
      }
    },
  }

  private static entityMap = new Map<number, Entity>();

  static getEntityByID(id: number): Entity | undefined {
    return Entity.entityMap.get(id);
  }
}


function destroy(nodeID: number | undefined, childNodeIDArray: number[]) {
  if (nodeID) {
    if (childNodeIDArray.includes(nodeID)) {
      arrayUtils.removeItemFromArray(childNodeIDArray, nodeID);
    }

    Godot.node.destroy(nodeID);
  }
}



