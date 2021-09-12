import { BeaverAdultEntity, DemoSave, UnknownEntity } from "../DemoSave";
import { IEditorPlugin } from "../IEditorPlugin";
import { Canvas } from '@react-three/fiber'
import { FormEvent, useMemo, useState } from "react";
import lodash, { get, set } from "lodash";
import { MapControls } from "@react-three/drei";
import './MapPlugin.scss';
import { Navbar } from "../Navbar";
import { BoxBufferGeometry, BufferGeometry, ConeBufferGeometry, Mesh, MeshStandardMaterial, PlaneBufferGeometry } from "three";
import { EffectComposer, SSAO as _SSAO } from "@react-three/postprocessing";
import { deepCopy } from "../deepCopy";

const SSAO = _SSAO as any;
const { BlendFunction } = require("postprocessing") as any;
const BufferGeometryUtils = require('three/examples/jsm/utils/BufferGeometryUtils.js') as any;

interface State {
  saveData: DemoSave;
  mapData: MapData;
  entityData: EntityData;
}

interface MutableState extends State {
  setEntity: (entity: UnknownEntity) => void;
  selectEntityId: (id: string|null) => void;
  selectedEntity: UnknownEntity|null;
}

interface MapData {
  i2x: (i: number) => number,
  i2y: (i: number) => number,
  i2xy: (i: number) => [number, number],
  i2xyz: (i: number, y: number) => [number, number, number],
  heightMap: Uint8Array;
  waterDepthMap: Float32Array;
  moistureMap: Float32Array;
  mapSizeX: number;
  mapSizeY: number;
}

interface EntityData {
  deleteIds: string[];
  updateIds: string[];
  entitiesByIds: Record<string, UnknownEntity>;
  entitiesIdsByTemplate: Record<string, string[]>;
}

const EDITABLE_ENTITIES = ["BeaverAdult", "BeaverChild", "Maple", "Pine", "Birch", "DirtPath"];

const useEntitiesOfTypes = (entityData: EntityData, templateIds: string[]) => {
  const {entitiesIdsByTemplate, entitiesByIds} = entityData;
  return useMemo(() => lodash(templateIds)
    .map(_ => entitiesIdsByTemplate[_])
    .flatten()
    .map((id) => entitiesByIds[id])
    .compact()
    .toJSON(), [templateIds, entitiesIdsByTemplate, entitiesByIds]);
}

function readEntityData(saveData: DemoSave) {
  return lodash(saveData.Entities)
    .filter(_ => EDITABLE_ENTITIES.includes(_.TemplateName))
    .reduce((acc, entity) => {
      acc.entitiesByIds[entity.Id] = entity;
      if (!acc.entitiesIdsByTemplate[entity.TemplateName]) {
        acc.entitiesIdsByTemplate[entity.TemplateName] = [];
      }
      acc.entitiesIdsByTemplate[entity.TemplateName].push(entity.Id);
      return acc;
    }, {
      deleteIds: [],
      updateIds: [],
      entitiesByIds: {},
      entitiesIdsByTemplate: {}
    } as EntityData)
}

function readMapData(saveData: DemoSave) {
  const {Singletons} = saveData;
  const mapSizeX = Singletons.MapSize.Size.X;
  const mapSizeY = Singletons.MapSize.Size.Y;

  return {
    i2x: (index: number) => index % mapSizeY,
    i2y: (index: number) => Math.floor(index / mapSizeY),
    i2xy: (index: number) => [index % mapSizeY, Math.floor(index / mapSizeY)] as [number, number],
    i2xyz: (index: number, y: number) => [index % mapSizeY, y, Math.floor(index / mapSizeY)] as [number, number, number],
    mapSizeX,
    mapSizeY,
    heightMap: Uint8Array.from(Singletons.TerrainMap.Heights.Array.split(" ").map(_ => parseInt(_, 10))),
    moistureMap: Float32Array.from(Singletons.SoilMoistureSimulator.MoistureLevels.Array.split(" ").map(_ => parseFloat(_))),
    waterDepthMap: Float32Array.from(Singletons.WaterMap.WaterDepths.Array.split(" ").map(_ => parseFloat(_))),
  }
}


export const MapPlugin: IEditorPlugin<State, State> = {
  id: "MapPlugin",
  name: "Map",
  position: 2,
  group: "General",
  enabled: true,

  read: (saveData) => ({
    mapData: readMapData(saveData),
    entityData: readEntityData(saveData),
    saveData
  }),

  write: (_saveData, { saveData }) => saveData,

  Preview: ({ saveData }) => <div>
    A 3D Map
  </div>,

  Editor: ({ initialData, onSubmit, onClose }) => {
    const [state, setState] = useState(initialData);
    const [selectedEntityId, selectEntityId] = useState<string|null>(null);
    const selectedEntity = (selectedEntityId && state.entityData.entitiesByIds[selectedEntityId]) || null;
    const {mapSizeX, mapSizeY} = state.mapData;

    const setEntity = (entity: UnknownEntity) => {
      const oldEntity: UnknownEntity|undefined = state.entityData.entitiesByIds[entity.Id];
      const newState = {
        ...state,
        entityData: {
          ...state.entityData,
          entitiesByIds: {
            ...state.entityData.entitiesByIds,
            [entity.Id]: entity,
          },
        }
      }

      if (!oldEntity || oldEntity.TemplateName !== entity.TemplateName) {
        newState.entityData.entitiesIdsByTemplate = {
          ...newState.entityData.entitiesIdsByTemplate,
          [oldEntity.TemplateName]: (newState.entityData.entitiesIdsByTemplate[oldEntity.TemplateName] || [])
            .filter(_ => !oldEntity || (oldEntity && _ !== oldEntity.Id)),
          [entity.TemplateName]: [...newState.entityData.entitiesIdsByTemplate[entity.TemplateName], entity.Id]
        };
      }

      setState(newState);
    }

    return <div className="Map__Editor">
      <Navbar onHome={onClose} />
      <Gui {...state} selectEntityId={selectEntityId} selectedEntity={selectedEntity} setEntity={setEntity} />

      <Canvas className="Map__Canvas" camera={{position: [32, 64, -64]}}>
        <EffectComposer>
          <SSAO
            blendFunction={BlendFunction.MULTIPLY}
            samples={50}
            radius={2}
            intensity={30}
          />
        </EffectComposer>
        <axesHelper position={[0, 8, 0]} scale={[4, 4, 4]} />
        <ambientLight intensity={0.3} />
        <directionalLight position={[10, 10, 10]} intensity={0.4} />
        <group scale={[1, 1, -1]}>
          <group position={[mapSizeX/-2, 0, mapSizeY/-2]}>
            <SlowBoxesHeightMap {...state} />
            <SlowBoxesWaterMap {...state} />
            <TreesMap {...state} />
            <PathsMap {...state} />
            <BeaversMap {...state} selectEntityId={selectEntityId} selectedEntity={selectedEntity} setEntity={setEntity} />
          </group>
        </group>
        <MapControls />
      </Canvas>
    </div>;
  }
}

function Gui(state: MutableState) {
  if (!state.selectedEntity) {
    return null;
  }

  return <div className="Map__Gui">
    <div className="Map__Gui__Right p-4">
      <div className="card">
        <div className="card-body">
          <h4 className="card-title">{state.selectedEntity.TemplateName}</h4>
          <BeaverForm {...state} />
        </div>
      </div>
    </div>
  </div>;
}

function BeaverForm({ selectedEntity, selectEntityId, setEntity }: MutableState) {
  const [beaver, setBeaver] = useState<BeaverAdultEntity>(selectedEntity as any);

  const getValue = (path: (string|number)[]) => get(beaver, path);
  const setValue = (path: (string|number)[], format: (val: string) => any = (x) => x) => (event: FormEvent) => setBeaver(set(deepCopy(beaver), path, format((event.target as any).value)))

  return <form onSubmit={(e) => { e.preventDefault(); setEntity(beaver); selectEntityId(null); }}>
    <div className="mb-3">
      <label htmlFor="name" className="form-label">Name</label>
      <input type="text" id="name" className="form-control" value={getValue(["Components", "Beaver", "Name"])} onChange={setValue(["Components", "Beaver", "Name"])} />
    </div>

    {beaver.Components.NeedManager.Needs.map((need, index) => <div className="mb-3" key={index}>
      <label htmlFor={"need-" + index} className="form-label">{need.Name}</label>
      <input type="range" min="0" max="1" step="0.001" id={"need-" + index} className="form-control"
        value={getValue(["Components", "NeedManager", "Needs", index, "Points"])}
        onChange={setValue(["Components", "NeedManager", "Needs", index, "Points"], (val) => parseFloat(val))} />
    </div>)}

    <div className="mb-3">
      <button type="submit" className="btn btn-primary">Save</button>
      {" "}
      <button type="button" onClick={() => selectEntityId(null)} className="btn btn-light">Discard</button>
    </div>
  </form>
}

function BeaversMap({ entityData, selectEntityId, selectedEntity }: MutableState) {
  const beavers = useEntitiesOfTypes(entityData, ["BeaverAdult", "BeaverChild"])

  return <group>
    {beavers.map((beaver) => <Beaver selected={selectedEntity === beaver} key={beaver.Id} beaver={beaver} selectEntityId={selectEntityId} />)}
  </group>;
}

function Beaver({ beaver, selectEntityId, selected }: { selected: boolean, beaver: UnknownEntity, selectEntityId: (id: string) => void }) {
  const [isHover, setIsHover] = useState(false);

  const onClick = () => { selectEntityId(beaver.Id); }
  const onPointerEnter = () => { setIsHover(true); }
  const onPointerLeave = () => { setIsHover(false); }

  const pos = (beaver.Components as any).Beaver.Position;
  const isAdult = beaver.TemplateName === "BeaverAdult";
  const x: number = pos.X;
  const y: number = pos.Y + 0.1 + (isAdult ? 0.5 : 0.3);
  const z: number = pos.Z;
  return <mesh onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onClick={onClick} key={beaver.Id} position={[x, y, z]}>
    <meshStandardMaterial color={selected ? "#651FFF" : (isHover ? "#FF8A65" : "#E64A19")} />
    <cylinderBufferGeometry args={[
      (isHover || selected) ? 0.6 : 0.4,
      (isHover || selected) ? 0.6 : 0.4,
      (beaver.TemplateName === "BeaverAdult" ? 1.0 : 0.6) * (isHover || selected ? 1.2 : 1.0),
      8.0,
      1.0,
    ]} />
  </mesh>;
}

function createTreeGeom({ dry, dead, adult, x, y, z }: {
  entity: any;
  dry: boolean;
  dead: boolean;
  adult: boolean;
  x: number;
  z: number;
  y: number;
}) {
  return new ConeBufferGeometry((adult ? 0.4 : 0.2) * (dead ? 0.5 : 1.0), adult ? 2.0 : 0.5, 4.0, 4.0)
    .translate(x, y + 0.5, z)
}

function meshWithColorFromGeoms(geometries: any[], color: string) {
  if (geometries.length === 0) {
    return new Mesh();
  }
  const geom = BufferGeometryUtils.mergeBufferGeometries(geometries)
  const mat = new MeshStandardMaterial({ color });
  return new Mesh(geom, mat);
}

function PathsMap({ entityData }: State) {
  const paths = useEntitiesOfTypes(entityData, ["DirtPath"]);
  const geom = useMemo(() => meshWithColorFromGeoms(paths
    .map((_: any) => new PlaneBufferGeometry(1, 1, 1, 1)
      .rotateX(-Math.PI/2)
      .translate(
        _.Components.BlockObject.Coordinates.X,
        _.Components.BlockObject.Coordinates.Z + 0.1,
        _.Components.BlockObject.Coordinates.Y
      ),
    ), "#BCAAA4"), [paths]);

  return <primitive object={geom} />;
}

function TreesMap({ entityData }: State) {
  const treeEntities = useEntitiesOfTypes(entityData, ["Pine", "Maple", "Birch"]);

  const {greenTrees, brownTrees} = useMemo(() => {
    const trees = treeEntities.map((_: any) => ({
        entity: _,
        dry: _.Components.WateredObject.IsDry as boolean,
        dead: _.Components.LivingNaturalResource.IsDead as boolean,
        adult: _.Components.Growable.GrowthProgress > 0.9999,
        x: _.Components.BlockObject.Coordinates.X as number,
        z: _.Components.BlockObject.Coordinates.Y as number,
        y: _.Components.BlockObject.Coordinates.Z as number,
      }));

    const greenTrees = meshWithColorFromGeoms(
      trees.filter(_ => !(_.dry || _.dead)).map(createTreeGeom), "#388E3C");
    const brownTrees = meshWithColorFromGeoms(
      trees.filter(_ => _.dry || _.dead).map(createTreeGeom), "#5D4037");

    return {greenTrees, brownTrees}
  }, [treeEntities]);

  return <group>
    <primitive object={greenTrees} />
    <primitive object={brownTrees} />
  </group>;
}

function SlowBoxesWaterMap({ mapData }: State) {
  const {i2x, i2y, heightMap, waterDepthMap} = mapData;

  const mesh = useMemo(() => {
    const geoms = lodash(waterDepthMap).reduce((acc, y, i) => {
      if (y > 0) {
        acc.push(new PlaneBufferGeometry(1, 1, 1, 1)
          .rotateX(-Math.PI/2)
          .translate(i2x(i), y + heightMap[i], i2y(i)));
      }
      return acc;
    }, [] as BufferGeometry[]);

    return meshWithColorFromGeoms(geoms, "#0044cc");
  }, [i2x, i2y, heightMap, waterDepthMap])

  return <primitive object={mesh} />;
}

function SlowBoxesHeightMap({ mapData }: State) {
  const {heightMap, moistureMap, i2x, i2y} = mapData;
  const {wetLand, dryLand} = useMemo(() => {
    const {wetBoxes, dryBoxes} = lodash(heightMap)
      .reduce((acc, height, index) => {
        const isWet = moistureMap[index] > 0;
        const box = new BoxBufferGeometry(1, height, 1, 1, 1, 1).translate(i2x(index), height / 2, i2y(index));
        (isWet ? acc.wetBoxes : acc.dryBoxes).push(box);
        return acc;
      }, { wetBoxes: [] as BufferGeometry[], dryBoxes: [] as BufferGeometry[] })

    return {
      wetLand: meshWithColorFromGeoms(wetBoxes, "#8BC34A"),
      dryLand: meshWithColorFromGeoms(dryBoxes, "#795548")
    }
  }, [i2x, i2y, heightMap, moistureMap])

  return <group>
    <primitive object={wetLand} />
    <primitive object={dryLand} />
  </group>;
}
