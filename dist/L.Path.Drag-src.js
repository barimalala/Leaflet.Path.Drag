/**
 * Matrix transform path for SVG/VML
 * TODO: adapt to Leaflet 0.8 upon release
 */

"use strict";

// Renderer-independent
L.Path.include({

	/**
	 * Applies matrix transformation to SVG
	 * @param {Array.<Number>?} matrix
	 */
	transform: function(matrix) {
		if (this._renderer) {
			if (matrix) {
				this._renderer.transformPath(this, matrix);
			} else {
				// reset transform matrix
				this._renderer._resetTransformPath(this);
				this._update();
			}
		}
		return this;
	},

	/**
	 * Check if the feature was dragged, that'll supress the click event
	 * on mouseup. That fixes popups for example
	 *
	 * @param  {MouseEvent} e
	 */
	_onMouseClick: function(e) {
		if ((this.dragging && this.dragging.moved()) ||
			(this._map.dragging && this._map.dragging.moved())) {
			return;
		}

		this._fireMouseEvent(e);
	}

});
/**
 * Leaflet vector features drag functionality
 * @preserve
 */

"use strict";

/**
 * Drag handler
 * @class L.Path.Drag
 * @extends {L.Handler}
 */
L.Handler.PathDrag = L.Handler.extend( /** @lends  L.Path.Drag.prototype */ {

	/**
	 * @param  {L.Path} path
	 * @constructor
	 */
	initialize: function(path) {

		/**
		 * @type {L.Path}
		 */
		this._path = path;

		/**
		 * @type {Array.<Number>}
		 */
		this._matrix = null;

		/**
		 * @type {L.Point}
		 */
		this._startPoint = null;

		/**
		 * @type {L.Point}
		 */
		this._dragStartPoint = null;

		/**
		 * @type {Boolean}
		 */
		this._mapDraggingWasEnabled = false;

	},

	/**
	 * Enable dragging
	 */
	addHooks: function() {
		this._path.on('mousedown', this._onDragStart, this);
		if (this._path._path) {
			L.DomUtil.addClass(this._path._path, 'leaflet-path-draggable');
		}
	},

	/**
	 * Disable dragging
	 */
	removeHooks: function() {
		this._path.off('mousedown', this._onDragStart, this);
		if (this._path._path) {
			L.DomUtil.removeClass(this._path._path, 'leaflet-path-draggable');
		}
	},

	/**
	 * @return {Boolean}
	 */
	moved: function() {
		return this._path._dragMoved;
	},

	/**
	 * Start drag
	 * @param  {L.MouseEvent} evt
	 */
	_onDragStart: function(evt) {
		this._mapDraggingWasEnabled = false;
		this._startPoint = evt.containerPoint.clone();
		this._dragStartPoint = evt.containerPoint.clone();
		this._matrix = [1, 0, 0, 1, 0, 0];
		L.DomEvent.stop(evt.originalEvent);

		L.DomUtil.addClass(this._path._renderer._container, 'leaflet-interactive');

		this._path._map.on('mousemove', this._onDrag, this);
		this._path
			.on('mousemove', this._onDrag, this)
			.on('mouseup', this._onDragEnd, this);

		if (this._path._map.dragging.enabled()) {
			this._mapDraggingWasEnabled = true;
			this._path._map.dragging.disable();
		}
		this._path._dragMoved = false;
	},

	/**
	 * Dragging
	 * @param  {L.MouseEvent} evt
	 */
	_onDrag: function(evt) {
		var x = evt.containerPoint.x;
		var y = evt.containerPoint.y;

		var dx = x - this._startPoint.x;
		var dy = y - this._startPoint.y;

		if (!this._path._dragMoved && (dx || dy)) {
			this._path._dragMoved = true;
			this._path.fire('dragstart');
			// we don't want that to happen on click
			this._path.bringToFront();
		}

		this._matrix[4] += dx;
		this._matrix[5] += dy;

		this._startPoint.x = x;
		this._startPoint.y = y;

		this._path.transform(this._matrix);
		this._path.fire('drag');
		L.DomEvent.stop(evt.originalEvent);
	},

	/**
	 * Dragging stopped, apply
	 * @param  {L.MouseEvent} evt
	 */
	_onDragEnd: function(evt) {
		// apply matrix
		if (this.moved()) {
			this._transformPoints(this._matrix);
			this._path._project();
			this._path.transform(null);
		}

		this._path._map.off('mousemove', this._onDrag, this);
		this._path
			.off('mousemove', this._onDrag, this)
			.off('mouseup', this._onDragEnd, this);

		// consistency
		this._path.fire('dragend', {
			distance: Math.sqrt(
				L.LineUtil._sqDist(this._dragStartPoint, evt.containerPoint)
			)
		});

		this._matrix = null;
		this._startPoint = null;
		this._dragStartPoint = null;

		if (this._mapDraggingWasEnabled) {
			this._path._map.dragging.enable();
		}
	},

	/**
	 * Applies transformation, does it in one sweep for performance,
	 * so don't be surprised about the code repetition.
	 *
	 * [ x ]   [ a  b  tx ] [ x ]   [ a * x + b * y + tx ]
	 * [ y ] = [ c  d  ty ] [ y ] = [ c * x + d * y + ty ]
	 *
	 * @param {Array.<Number>} matrix
	 */
	_transformPoints: function(matrix) {
		var path = this._path;
		var i, len, latlng;

		var px = L.point(matrix[4], matrix[5]);

		var crs = path._map.options.crs;
		var transformation = crs.transformation;
		var scale = crs.scale(path._map.getZoom());
		var projection = crs.projection;

		var diff = transformation.untransform(px, scale)
			.subtract(transformation.untransform(L.point(0, 0), scale));

		path._bounds = new L.LatLngBounds();

		// console.time('transform');
		// all shifts are in-place
		if (path._point) { // L.Circle
			path._latlng = projection.unproject(
				projection.project(path._latlng)._add(diff));
			path._point._add(px);
		} else if (path._rings || path._parts) { // everything else
			var rings = path._rings || path._parts;
			var latlngs = path._latlngs;
			if (!L.Util.isArray(latlngs[0])) { // polyline
				latlngs = [latlngs];
			}
			for (i = 0, len = rings.length; i < len; i++) {
				for (var j = 0, jj = rings[i].length; j < jj; j++) {
					latlng = latlngs[i][j];
					latlngs[i][j] = projection
						.unproject(projection.project(latlng)._add(diff));
					path._bounds.extend(latlngs[i][j]);
					rings[i][j]._add(px);
				}
			}
		}
		// console.timeEnd('transform');

		path._updatePath();
	}

});

L.Path.addInitHook(function() {
	if (this.options.draggable) {
		if (this.dragging) {
			this.dragging.enable();
		} else {
			this.dragging = new L.Handler.PathDrag(this);
			this.dragging.enable();
		}
	} else if (this.dragging) {
		this.dragging.disable();
	}
});
L.SVG.include({

	/**
	 * Reset transform matrix
	 */
	_resetTransformPath: function(layer) {
		layer._path.setAttributeNS(null, 'transform', '');
	},

	/**
	 * Applies matrix transformation to SVG
	 * @param {L.Path}         layer
	 * @param {Array.<Number>} matrix
	 */
	transformPath: function(layer, matrix) {
		layer._path.setAttributeNS(null, "transform",
			'matrix(' + matrix.join(' ') + ')');
	}

});
L.SVG.include(!L.Browser.vml ? {} : {

	/**
	 * Reset transform matrix
	 */
	_resetTransformPath: function(layer) {
		if (layer._skew) {
			// super important! workaround for a 'jumping' glitch:
			// disable transform before removing it
			layer._skew.on = false;
			layer._path.removeChild(layer._skew);
			layer._skew = null;
		}
	},

	/**
	 * Applies matrix transformation to VML
	 * @param {L.Path}         layer
	 * @param {Array.<Number>} matrix
	 */
	transformPath: function(layer, matrix) {
		var skew = layer._skew;

		if (!skew) {
			skew = L.SVG.create('skew');
			layer._path.appendChild(skew);
			skew.style.behavior = 'url(#default#VML)';
			layer._skew = skew;
		}

		// handle skew/translate separately, cause it's broken
		var mt = matrix[0].toFixed(8) + " " + matrix[1].toFixed(8) + " " +
			matrix[2].toFixed(8) + " " + matrix[3].toFixed(8) + " 0 0";
		var offset = Math.floor(matrix[4]).toFixed() + ", " +
			Math.floor(matrix[5]).toFixed() + "";

		var s = this._path.style;
		var l = parseFloat(s.left);
		var t = parseFloat(s.top);
		var w = parseFloat(s.width);
		var h = parseFloat(s.height);

		if (isNaN(l)) l = 0;
		if (isNaN(t)) t = 0;
		if (isNaN(w) || !w) w = 1;
		if (isNaN(h) || !h) h = 1;

		var origin = (-l / w - 0.5).toFixed(8) + " " + (-t / h - 0.5).toFixed(8);

		skew.on = "f";
		skew.matrix = mt;
		skew.origin = origin;
		skew.offset = offset;
		skew.on = true;
	}

});
L.Util.trueFn = function() {
	return true;
};

L.Canvas.include({

	/**
	 * Do nothing
	 * @param  {L.Path} layer
	 */
	_resetTransformPath: function(layer) {
		if (!this._containerCopy) {
			return;
		}
		delete this._containerCopy;

		if (layer._containsPoint_) {
			layer._containsPoint = layer._containsPoint_;
			delete layer._containsPoint_;

			this._requestRedraw(layer);
			this._draw(true);
		}
	},

	/**
	 * Algorithm outline:
	 *
	 * 1. pre-transform - clear the path out of the canvas, copy canvas state
	 * 2. at every frame:
	 *    2.1. save
	 *    2.2. redraw the canvas from saved one
	 *    2.3. transform
	 *    2.4. draw path
	 *    2.5. restore
	 *
	 * @param  {L.Path} layer
	 * @param  {Array.<Number>} matrix
	 */
	transformPath: function(layer, matrix) {
		var copy = this._containerCopy;
		var ctx = this._ctx;

		if (!copy) {
			copy = this._containerCopy = document.createElement('canvas');
			copy.width = this._container.width;
			copy.height = this._container.height;

			layer._removed = true;
			this._redraw();

			copy.getContext('2d').translate(this._bounds.min.x, this._bounds.min.y);
			copy.getContext('2d').drawImage(this._container, 0, 0);
			this._initPath(layer);
			layer._containsPoint_ = layer._containsPoint;
			layer._containsPoint = L.Util.trueFn;
		}

		ctx.save();
		ctx.clearRect(0, 0, copy.width, copy.height);
		ctx.drawImage(this._containerCopy, 0, 0);
		ctx.transform.apply(this._ctx, matrix);

		var layers = this._layers;
		this._layers = {};

		this._initPath(layer);
		layer._updatePath();

		this._layers = layers;
		ctx.restore();
	}

});
