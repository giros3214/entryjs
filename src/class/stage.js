/**
 * Stage is object to handle canvas
 * @fileoverview This manage canvas
 *
 */

'use strict';

import ColorSpoid from '../playground/colorSpoid';
import Extension from '../extensions/extension';
import { GEHelper } from '../graphicEngine/GEHelper';
import { GEHandle } from '../graphicEngine/GEHandle';
import { PIXIAtlasManager } from './pixi/atlas/PIXIAtlasManager';

/**
 * class for a canvas
 * @constructor
 */
Entry.Stage = function() {
    /** @type {Dictionary} */
    this.variables = {};
    this.objectContainers = [];
    this.selectedObjectContainer = null;

    /** @type {null|Entry.EntryObject} */
    this.selectedObject = null;
    this.isObjectClick = false;
    this._entitySelectable = true;

    /** @type {PIXI.Application | CreateJsApplication} */
    this._app = null;
};

/**
 * initialize stage with canvas
 * @param {!Element} canvas for stage
 */
Entry.Stage.prototype.initStage = function(canvas) {
    this._app = GEHelper.newApp(canvas);
    this.canvas = this._app.stage;
    this.canvas.x = 960 / 1.5 / 2;
    this.canvas.y = 540 / 1.5 / 2;
    this.canvas.scaleX = this.canvas.scaleY = 2 / 1.5;

    this.background = GEHelper.newGraphic();
    this.background.graphics.beginFill('#ffffff').drawRect(-480, -240, 960, 480);
    this.variableContainer = GEHelper.newContainer('variableContainer');
    this.dialogContainer = GEHelper.newContainer('dialogContainer');

    this.canvas.addChild(this.background);
    this.canvas.addChild(this.variableContainer);
    this.canvas.addChild(this.dialogContainer);
    this.inputField = null;
    this.initCoordinator();
    this.initHandle();
    this.mouseCoordinate = { x: 0, y: 0 };

    const _addEventListener = Entry.addEventListener.bind(Entry);

    if (Entry.isPhone()) {
        canvas.ontouchstart = function(e) {
            Entry.dispatchEvent('canvasClick', e);
            Entry.stage.isClick = true;
        };
        canvas.ontouchend = function(e) {
            Entry.stage.isClick = false;
            Entry.dispatchEvent('canvasClickCanceled', e);
        };
    } else {
        const downFunc = function(e) {
            Entry.dispatchEvent('canvasClick', e);
            Entry.stage.isClick = true;
        };

        canvas.onmousedown = downFunc;
        canvas.ontouchstart = downFunc;

        const upFunc = function(e) {
            Entry.stage.isClick = false;
            Entry.dispatchEvent('canvasClickCanceled', e);
        };

        canvas.onmouseup = upFunc;
        canvas.ontouchend = upFunc;

        $(document).click(({ target: { id } }) => {
            this.focused = id === 'entryCanvas';
        });
    }

    _addEventListener('canvasClick', () => (Entry.stage.isObjectClick = false));
    _addEventListener('loadComplete', this.sortZorder.bind(this));
    Entry.windowResized.attach(this, this.updateBoundRect.bind(this));

    const razyScroll = _.debounce(() => {
        Entry.windowResized.notify();
    }, 200);

    $(window).scroll(() => {
        window.requestAnimationFrame(razyScroll);
    });

    const moveFunc = function(e) {
        e.preventDefault();
        const { pageX, pageY } = Entry.Utils.convertMouseEvent(e);
        const roundRect = Entry.stage.getBoundRect();
        const scrollPos = Entry.Utils.getScrollPos();
        this.mouseCoordinate = {
            x: Entry.Utils.toFixed(
                ((pageX - roundRect.left - scrollPos.left) / roundRect.width - 0.5) * 480
            ),
            y: Entry.Utils.toFixed(
                ((pageY - roundRect.top - scrollPos.top) / roundRect.height - 0.5) * -270
            ),
        };
        Entry.dispatchEvent('stageMouseMove');
    }.bind(this);

    canvas.onmousemove = moveFunc;
    canvas.ontouchmove = moveFunc;

    canvas.onmouseout = () => Entry.dispatchEvent('stageMouseOut');
    const updateObjectFunc = () => {
        if (Entry.engine.isState('stop')) {
            Entry.stage.updateObject();
        }
    };
    _addEventListener('updateObject', updateObjectFunc);
    _addEventListener('run', () => Entry.removeEventListener('updateObject', updateObjectFunc));
    _addEventListener('stop', () => _addEventListener('updateObject', updateObjectFunc));
    _addEventListener('canvasInputComplete', () => {
        try {
            const inputValue = this.inputField.value();
            this.hideInputField();
            if (inputValue) {
                ((c) => {
                    c.setInputValue(inputValue);
                    c.inputValue.complete = true;
                })(Entry.container);
            }
        } catch (exception) {}
    });

    this.initWall();
    this.render();
    this.colorSpoid = new ColorSpoid(this, canvas);
    this.dropper = Extension.getExtension('Dropper');
};

Entry.Stage.prototype.render = function stageRender() {
    if (Entry.stage.timer) {
        clearTimeout(Entry.stage.timer);
    }
    let time = _.now();
    Entry.stage.update();
    time = _.now() - time;
    Entry.stage.timer = setTimeout(stageRender, 16 - (time % 16) + 16 * Math.floor(time / 16));
};

/**
 * redraw canvas
 */
Entry.Stage.prototype.update = function() {
    if (Entry.type === 'invisible') {
        return;
    }

    if (!Entry.requestUpdate) {
        Entry.requestUpdate = false;
        return;
    }
    this._app.render();

    if (Entry.engine.isState('stop') && this.objectUpdated) {
        this.objectUpdated = false;
    }

    const inputField = this.inputField;
    if (inputField && !inputField._isHidden) {
        inputField.render();
    }
    if (Entry.requestUpdateTwice) {
        Entry.requestUpdateTwice = false;
    } else {
        Entry.requestUpdate = false;
    }
};

Entry.Stage.prototype.updateForce = function() {
    this._app && this._app.render();
};

/**
 * add object entity on canvas
 * @param {Entry.EntryObject} object
 */
Entry.Stage.prototype.loadObject = function({ entity: { object }, scene }) {
    this.getObjectContainerByScene(scene).addChild(object);
    Entry.requestUpdate = true;
};

/**
 * add entity directly on canvas
 * This is use for cloned entity
 * @param {Entry.EntityObject} entity
 */
Entry.Stage.prototype.loadEntity = function({ parent, object }, index) {
    const objContainer = Entry.stage.getObjectContainerByScene(parent.scene);
    if (index > -1) {
        objContainer.addChildAt(object, index);
    } else {
        objContainer.addChild(object);
    }
    Entry.requestUpdate = true;
};

/**
 * Remove entity directly on canvas
 * @param {Entry.EntityObject} entity
 */
Entry.Stage.prototype.unloadEntity = function({ parent, object }) {
    Entry.stage.getObjectContainerByScene(parent.scene).removeChild(object);
    Entry.requestUpdate = true;
};

/**
 * add variable view on canvas
 * @param {Entry.Variable} object
 */
Entry.Stage.prototype.loadVariable = function({ view_, id }) {
    this.variables[id] = view_;
    this.variableContainer.addChild(view_);
    Entry.requestUpdate = true;
};

/**
 * remove variable view on canvas
 * @param {Entry.Variable} object
 */
Entry.Stage.prototype.removeVariable = function({ view_ }) {
    this.variableContainer.removeChild(view_);
    Entry.requestUpdate = true;
};

/**
 * add dialog on canvas
 * @param {Entry.Dialog} dialog
 */
Entry.Stage.prototype.loadDialog = function({ object }) {
    this.dialogContainer.addChild(object);
};

/**
 * Remove entity directly on canvas
 * @param {Entry.Dialog} dialog
 */
Entry.Stage.prototype.unloadDialog = function({ object }) {
    this.dialogContainer.removeChild(object);
};

Entry.Stage.prototype.setEntityIndex = function({ object }, index) {
    if (index === -1) {
        return;
    }
    const selectedObjectContainer = Entry.stage.selectedObjectContainer;
    const currentIndex = selectedObjectContainer.getChildIndex(object);

    if (currentIndex === -1 || currentIndex === index) {
        return;
    }
    selectedObjectContainer.setChildIndex(object, index);
    Entry.requestUpdate = true;
};

/**
 * sort Z index of objects
 */
Entry.Stage.prototype.sortZorder = function() {
    let objects = Entry.container.getCurrentObjects().slice(),
        length = objects.length,
        container = this.selectedObjectContainer,
        index = 0;

    for (let i = length - 1; i >= 0; i--) {
        const {
            entity: { object },
        } = objects[i];
        container.setChildIndex(object, index++);
    }

    Entry.requestUpdate = true;
};

/**
 * sort Z index of objects while running
 */
Entry.Stage.prototype.sortZorderRun = function() {
    Entry.requestUpdate = true;
};

/**
 * Initialize coordinate on canvas. It is toggle by Engine.
 */
Entry.Stage.prototype.initCoordinator = function() {
    const tex = GEHelper.newSpriteWithCallback(`${Entry.mediaFilePath}workspace_coordinate.png`);
    this.coordinator = Object.assign(tex, {
        scaleX: 0.5,
        scaleY: 0.5,
        x: -240,
        y: -135,
        visible: false,
    });
    if (!GEHelper.isWebGL) {
        this.coordinator.tickEnabled = false;
    }
    this.canvas.addChild(this.coordinator);
};

/**
 * Toggle coordinator
 */
Entry.Stage.prototype.toggleCoordinator = function() {
    this.coordinator.visible = !this.coordinator.visible;
    Entry.requestUpdate = true;
};

/**
 * Select handle object
 * @param {?Entry.EntryObject} object
 */
Entry.Stage.prototype.selectObject = function(object) {
    //todo
    if (!object) {
        this.selectedObject = null;
    } else {
        this.selectedObject = object;
    }
    this.updateObject();
};

/**
 * Initialize handle. Handle is use for transform object on canvas.
 */
Entry.Stage.prototype.initHandle = function() {
    this.handle = new GEHandle(this.canvas)
        .setChangeListener(this, this.updateHandle)
        .setEditStartListener(this, this.startEdit)
        .setEditEndListener(this, this.endEdit);
};

/**
 * Update handle object to modified object
 * object -> handle
 */
Entry.Stage.prototype.updateObject = function() {
    if (Entry.type === 'invisible') {
        return;
    }
    Entry.requestUpdate = true;
    this.handle.setDraggable(true);
    if (this.editEntity) {
        return;
    }
    const object = this.selectedObject;
    if (object) {
        if (object.objectType == 'textBox') {
            this.handle.toggleCenter(false);
        } else {
            this.handle.toggleCenter(true);
        }
        const rotateMethod = object.getRotateMethod();
        if (rotateMethod == 'free') {
            this.handle.toggleRotation(true);
            this.handle.toggleDirection(true);
        } else if (rotateMethod == 'vertical') {
            this.handle.toggleRotation(false);
            this.handle.toggleDirection(true);
        } else {
            this.handle.toggleRotation(false);
            this.handle.toggleDirection(true);
        }
        if (object.getLock()) {
            this.handle.toggleRotation(false);
            this.handle.toggleDirection(false);
            this.handle.toggleResize(false);
            this.handle.toggleCenter(false);
            this.handle.setDraggable(false);
        } else {
            this.handle.toggleResize(true);
        }
        this.handle.setVisible(true);
        const entity = object.entity;
        this.handle.setWidth(entity.getScaleX() * entity.getWidth());
        this.handle.setHeight(entity.getScaleY() * entity.getHeight());
        let regX, regY;
        if (entity.type == 'textBox') {
            // maybe 0.
            if (entity.getLineBreak()) {
                regX = entity.regX * entity.scaleX;
                regY = -entity.regY * entity.scaleY;
            } else {
                const fontAlign = entity.getTextAlign();
                regY = -entity.regY * entity.scaleY;
                switch (fontAlign) {
                    case Entry.TEXT_ALIGN_LEFT:
                        regX = (-entity.getWidth() / 2) * entity.scaleX;
                        break;
                    case Entry.TEXT_ALIGN_CENTER:
                        regX = entity.regX * entity.scaleX;
                        break;
                    case Entry.TEXT_ALIGN_RIGHT:
                        regX = (entity.getWidth() / 2) * entity.scaleX;
                        break;
                }
            }
        } else {
            regX = (entity.regX - entity.width / 2) * entity.scaleX;
            regY = (entity.height / 2 - entity.regY) * entity.scaleY;
        }

        const rotation = (entity.getRotation() / 180) * Math.PI;

        this.handle.setX(entity.getX() - regX * Math.cos(rotation) - regY * Math.sin(rotation));
        this.handle.setY(-entity.getY() - regX * Math.sin(rotation) + regY * Math.cos(rotation));
        this.handle.setRegX((entity.regX - entity.width / 2) * entity.scaleX);
        this.handle.setRegY((entity.regY - entity.height / 2) * entity.scaleY);
        this.handle.setRotation(entity.getRotation());
        this.handle.setDirection(entity.getDirection());
        this.objectUpdated = true;

        this.handle.setVisible(object.entity.getVisible());
        if (object.entity.getVisible()) {
            this.handle.render();
        }
    } else {
        this.handle.setVisible(false);
    }
    //this.toggleHandleEditable(!object.getLock());
};

// handle -> object
Entry.Stage.prototype.updateHandle = function() {
    this.editEntity = true;
    const handle = this.handle;
    const entity = this.selectedObject.entity;
    if (entity.lineBreak) {
        entity.setHeight(handle.height / entity.getScaleY());
        entity.setWidth(handle.width / entity.getScaleX());
    } else {
        if (entity.width !== 0) {
            let scaleX = Math.abs(handle.width / entity.width);
            if (entity.flip) {
                scaleX *= -1;
            }

            entity.setScaleX(scaleX);
        }

        if (entity.height !== 0) {
            entity.setScaleY(handle.height / entity.height);
        }
    }
    const direction = (handle.rotation / 180) * Math.PI;
    if (entity.type == 'textBox') {
        entity.syncFont();
        var newRegX = handle.regX / entity.scaleX;
        var newRegY = handle.regY / entity.scaleY;

        if (entity.getLineBreak()) {
            entity.setX(handle.x);
            entity.setY(-handle.y);
        } else {
            switch (entity.getTextAlign()) {
                case Entry.TEXT_ALIGN_LEFT:
                    entity.setX(handle.x - (handle.width / 2) * Math.cos(direction));
                    entity.setY(-handle.y + (handle.width / 2) * Math.sin(direction));
                    break;
                case Entry.TEXT_ALIGN_CENTER:
                    entity.setX(handle.x);
                    entity.setY(-handle.y);
                    break;
                case Entry.TEXT_ALIGN_RIGHT:
                    entity.setX(handle.x + (handle.width / 2) * Math.cos(direction));
                    entity.setY(-handle.y - (handle.width / 2) * Math.sin(direction));
                    break;
            }
        }
    } else {
        var newRegX = entity.width / 2 + handle.regX / entity.scaleX;
        entity.setX(
            handle.x + handle.regX * Math.cos(direction) - handle.regY * Math.sin(direction)
        );
        entity.setRegX(newRegX);
        var newRegY = entity.height / 2 + handle.regY / entity.scaleY;
        entity.setY(
            -handle.y - handle.regX * Math.sin(direction) - handle.regY * Math.cos(direction)
        );
        entity.setRegY(newRegY);
    }
    entity.setDirection(handle.direction);
    entity.setRotation(handle.rotation);
    this.editEntity = false;
};

Entry.Stage.prototype.startEdit = function() {
    const { entity } = this.selectedObject || {};
    _.result(entity, 'initCommand');
};

Entry.Stage.prototype.endEdit = function() {
    const { entity } = this.selectedObject || {};
    _.result(entity, 'checkCommand');
};

Entry.Stage.prototype.initWall = function() {
    const wall = GEHelper.newContainer('wall');
    wall.mouseEnabled = false;
    const tex = GEHelper.newWallTexture(`${Entry.mediaFilePath}media/bound.png`);
    const newSide = (x, y, sx, sy) => {
        const sp = GEHelper.newWallSprite(tex);
        sp.x = x;
        sp.y = y;
        sx ? (sp.scaleX = sx) : 0;
        sy ? (sp.scaleY = sy) : 0;
        wall.addChild(sp);
        return sp;
    };

    wall.up = newSide(-240, -135 - 30, 480 / 30, 0);
    wall.down = newSide(-240, 135, 480 / 30, 0);
    wall.right = newSide(240, -135, 0, 270 / 30);
    wall.left = newSide(-240 - 30, -135, 0, 270 / 30);

    this.canvas.addChild(wall);
    this.wall = wall;
};

/**
 * show inputfield from the canvas
 */
Entry.Stage.prototype.showInputField = function() {
    const THIS = this;
    const isWebGL = GEHelper.isWebGL;

    if (!this.inputField) {
        this.inputField = _createInputField();
        this.inputSubmitButton = _createSubmitButton();
    }

    this.inputField.value('');
    if (isWebGL) {
        this.canvas.addChild(this.inputField.getPixiView());
    }
    this.inputField.show();
    this.canvas.addChild(this.inputSubmitButton);

    Entry.requestUpdateTwice = true;

    function _createInputField() {
        const scale = 1 / 1.5;
        const posX = 202 * scale;
        const posY = 450 * scale;
        const isWebGL = GEHelper.isWebGL;
        const classRef = isWebGL ? window.PIXICanvasInput : CanvasInput;
        const inputField = new classRef({
            canvas: document.getElementById('entryCanvas'),
            fontSize: 30 * scale,
            fontFamily: EntryStatic.fontFamily || 'NanumGothic',
            fontColor: '#212121',
            width: Math.round(556 * scale),
            height: 26 * scale,
            padding: 8 * scale,
            borderWidth: 1 * scale,
            borderColor: '#000',
            borderRadius: 3,
            boxShadow: 'none',
            innerShadow: '0px 0px 5px rgba(0, 0, 0, 0.5)',
            x: posX,
            y: posY,
            readonly: false,
            topPosition: true,
            onsubmit() {
                Entry.dispatchEvent('canvasInputComplete');
            },
        });

        if (isWebGL) {
            const canvas = THIS.canvas;
            const globalScale = canvas.scale.x;
            const textView = inputField.getPixiView();
            textView.scale.set(1 / globalScale);
            textView.position.set(
                posX / globalScale - canvas.x / globalScale,
                posY / globalScale - canvas.y / globalScale
            );
        }
        return inputField;
    } //_createInputField

    function _createSubmitButton() {
        const { confirm_button } = EntryStatic.images || {};
        const path = confirm_button || `${Entry.mediaFilePath}confirm_button.png`;
        const inputSubmitButton = GEHelper.newSpriteWithCallback(path, () => {
            Entry.requestUpdate = true;
        });
        inputSubmitButton.mouseEnabled = true;
        inputSubmitButton.scaleX = 0.23;
        inputSubmitButton.scaleY = 0.23;
        inputSubmitButton.x = 160;
        inputSubmitButton.y = 89;
        inputSubmitButton.cursor = 'pointer';

        const eventType = isWebGL ? 'pointerdown' : 'mousedown';
        inputSubmitButton.on(eventType, () => {
            if (!THIS.inputField._readonly) {
                Entry.dispatchEvent('canvasInputComplete');
            }
        });
        return inputSubmitButton;
    } //_createSubmitButton
};

/**
 * remove inputfield from the canvas
 */
Entry.Stage.prototype.hideInputField = function() {
    if (!this.inputField) {
        return;
    }

    if (GEHelper.isWebGL) {
        this.canvas.removeChild(this.inputField.getPixiView());
    }
    this.inputField.value('');
    this.inputField.hide();

    this.canvas.removeChild(this.inputSubmitButton);

    Entry.requestUpdate = true;
};

/**
 * init object containers
 */
Entry.Stage.prototype.initObjectContainers = function() {
    const scenes = Entry.scene.scenes_;
    if (!_.isEmpty(scenes)) {
        for (let i = 0; i < scenes.length; i++) {
            this.objectContainers[i] = this.createObjectContainer(scenes[i]);
        }
        this.selectedObjectContainer = this.objectContainers[0];
    } else {
        const obj = this.createObjectContainer(Entry.scene.selectedScene);
        this.objectContainers.push(obj);
        this.selectedObjectContainer = obj;
    }
    if (Entry.type !== 'invisible') {
        this.canvas.addChild(this.selectedObjectContainer);
    }
    this.selectObjectContainer(Entry.scene.selectedScene);
};

/**
 * select object container by scene
 * @param {Entry.Scene} scene
 */
Entry.Stage.prototype.selectObjectContainer = function(scene) {
    const containers = this.objectContainers;
    const canvas = this.canvas;

    if (_.isEmpty(canvas) || _.isEmpty(containers)) {
        return;
    }
    GEHelper.resManager.activateScene(scene && scene.id);
    const newContainer = this.getObjectContainerByScene(scene);

    containers.forEach(canvas.removeChild.bind(canvas));

    this.selectedObjectContainer = newContainer;
    canvas.addChildAt(newContainer, 2);
};

/**
 * init object containers
 */
Entry.Stage.prototype.createObjectContainer = function(scene) {
    return Object.assign(GEHelper.newContainer('[Stage] SceneContainer'), { scene });
};

/**
 * remove object container
 * @param {scene model} scene
 */
Entry.Stage.prototype.removeObjectContainer = function(scene) {
    const containers = this.objectContainers;
    const objContainer = this.getObjectContainerByScene(scene);
    const canvas = this.canvas;
    if (canvas) {
        canvas.removeChild(objContainer);
    }
    GEHelper.resManager.removeScene(scene.id);
    containers.splice(containers.indexOf(objContainer), 1);
};

/**
 * get object container
 * @param {scene model} scene
 */
Entry.Stage.prototype.getObjectContainerByScene = function({ id }) {
    return _.find(this.objectContainers, ({ scene } = {}) => scene.id === id);
};

Entry.Stage.prototype.moveSprite = function({ shiftKey, keyCode }) {
    const selectedObject = this.selectedObject;
    if (!selectedObject || !Entry.stage.focused || selectedObject.getLock()) {
        return;
    }

    const distance = shiftKey ? 1 : 5;

    const entity = selectedObject.entity;
    switch (keyCode) {
        case 38: //up
            entity.setY(entity.getY() + distance);
            break;
        case 40: //down
            entity.setY(entity.getY() - distance);
            break;
        case 37: //left
            entity.setX(entity.getX() - distance);
            break;
        case 39: //right
            entity.setX(entity.getX() + distance);
            break;
    }
    this.updateObject();
};

Entry.Stage.prototype.getBoundRect = function(e) {
    if (!this._boundRect) {
        return this.updateBoundRect();
    }
    return this._boundRect;
};

Entry.Stage.prototype.updateBoundRect = function(e) {
    return (this._boundRect = this.canvas.canvas.getBoundingClientRect());
};

Entry.Stage.prototype.getDom = function(query) {
    const key = query.shift();
    if (key === 'canvas') {
        return this.canvas.canvas;
    }
};

Entry.Stage.prototype.setEntitySelectable = function(value) {
    this._entitySelectable = value;
};

Entry.Stage.prototype.isEntitySelectable = function() {
    return Entry.engine.isState('stop') && this._entitySelectable && !this.dropper.isShow;
};

Entry.Stage.prototype.destroy = function() {
    let destroyOption;
    if (GEHelper.isWebGL) {
        destroyOption = { children: true, texture: false, baseTexture: false };
        this.objectContainers.forEach((c) => c.destroy(destroyOption));
        //this.handle.destroy(); // 추상화 아직 안됨.
        PIXIAtlasManager.clearProject();
    } else {
        //do nothing
    }
    if (this._app) {
        this._app.destroy(destroyOption);
        this._app = null;
    }
    this.handle = null;
    this.objectContainers = null;
};
