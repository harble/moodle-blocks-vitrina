/* eslint linebreak-style: 0 */
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Javascript to initialise the block.
 *
 * @module block_vitrina/main
 * @copyright 2023 David Herney @ BambuCo
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
import $ from 'jquery';
import {get_strings as getStrings} from 'core/str';
import Notification from 'core/notification';
import Log from 'core/log';
import Ajax from 'core/ajax';

/**
 * Private functions.
 *
 */

// Current instance (optional).
var instanceid = [];

// Courses by page.
var bypage = [];

// Paging variable controls.
var paging = [];

// Fixed filters per block instance (keyed by uniqueid).
// Used mainly for block instances that must always apply
// some filters (for example, a fixed course category) even
// when there is no visible filters UI.
var fixedfilters = [];

// Filters box.
var $filtersbox = null;

// Loading courses.
var loading = false;

// Load strings.
var strings = [
    {key: 'courselinkcopiedtoclipboard', component: 'block_vitrina'},
    {key: 'nocoursesview', component: 'block_vitrina'},
    {key: 'nomorecourses', component: 'block_vitrina'},
];
var s = [];

/**
 * Load strings from server.
 */
function loadStrings() {

    strings.forEach(one => {
        s[one.key] = one.key;
    });

    getStrings(strings).then(function(results) {
        var pos = 0;
        strings.forEach(one => {
            s[one.key] = results[pos];
            pos++;
        });
        return true;
    }).fail(function(e) {
        Log.debug('Error loading strings');
        Log.debug(e);
    });
}
// End of Load strings.

/**
 * Load courses for a tab.
 *
 * @param {integer} uniqueid
 * @param {object} $tabcontent
 */
function loadCourses(uniqueid, $tabcontent) {

    var view = $tabcontent.data('view');

    $tabcontent.addClass('loading');
    var $coursesbox = $tabcontent.find('.courses-list');

    if (paging[uniqueid] === undefined) {
        paging[uniqueid] = [];
    }

    if (paging[uniqueid][view] === undefined) {
        paging[uniqueid][view] = {
            loaded: 0,
            ended: false,
        };
    }

    // Not more courses.
    if (paging[uniqueid][view].ended) {
        $tabcontent.removeClass('loading');
        return;
    }

    // Check active filters.
    var filters = [];

    if ($filtersbox) {
        var $fulltextcontrol = $filtersbox.find('.filterfulltext input[name=q]');

        if ($fulltextcontrol.length > 0) {
            var $fulltext = $fulltextcontrol.val().trim();

            if ($fulltext) {
                filters.push({
                    'values': [$fulltext],
                    'type': 'fulltext',
                });
            }
        }

        $filtersbox.find('.filtercontrol').each(function() {
            var $control = $(this);
            var key = $control.data('key');
            var values = [];

            $control.find('.filteroptions input:checked').each(function() {
                var $option = $(this);
                values.push($option.val());
            });

            if (values.length > 0) {
                filters.push({
                    'values': values,
                    'type': key
                });
            } else if (key === 'categories') {
                // User has explicitly unselected all categories.
                // Send an explicit empty categories filter so the backend can
                // distinguish this case from "no categories filter" and
                // return no courses instead of falling back to defaults.
                filters.push({
                    'values': [],
                    'type': key
                });
            } else if (key === 'tags') {
                // When the block instance has configured course tags, they
                // are shown as a checkbox list (key = "tags"). If the user
                // unchecks all of them, send an explicit empty "tags"
                // filter so that the backend knows tag-based filtering has
                // been cleared and does NOT fall back to the block's
                // default configured tags.
                filters.push({
                    'values': [],
                    'type': key
                });
            }
        });

        // Tags dropdown filter (single-select). If a tag is selected, add a
        // "tags" filter for the backend.
        var $tagselect = $filtersbox.find('select[name="tagsfilter"]');
        if ($tagselect.length > 0) {
            var tagvalue = $tagselect.val();
            if (tagvalue) {
                filters.push({
                    'values': [tagvalue],
                    'type': 'tags'
                });
            }
        }
    }
    // End of check active filters.

    // Apply any fixed filters configured for this block instance
    // (for example, a fixed categories filter when the block is
    // configured to split by category into multiple sections).
    if (fixedfilters[uniqueid]) {
        fixedfilters[uniqueid].forEach(function(fixed) {
            // Remove existing filters of the same type so the
            // fixed filter takes precedence.
            filters = filters.filter(function(current) {
                return current.type !== fixed.type;
            });
            filters.push(fixed);
        });
    }

    var sort = '';
    var sortdirection = '';

    if ($filtersbox) {
        var $sortcontrol = $filtersbox.find('.filtersort select[name="sort"]');
        if ($sortcontrol.length > 0) {
            sort = $sortcontrol.val();
        }

        var $sortdirectioncontrol = $filtersbox.find('.filtersortdirection select[name="sortdirection"]');
        if ($sortdirectioncontrol.length > 0) {
            sortdirection = $sortdirectioncontrol.val();
        }
    }

    loading = true;
    Ajax.call([{
        methodname: 'block_vitrina_get_courses',
        args: {'view': view, 'filters': filters, 'instanceid': instanceid[uniqueid],
            'amount': bypage[uniqueid], 'initial': paging[uniqueid][view].loaded,
            'sort': sort, 'sortdirection': sortdirection},
        done: function(data) {

            if (data && data.length > 0) {
                paging[uniqueid][view].loaded += data.length;

                if (data.length < bypage[uniqueid]) {
                    paging[uniqueid][view].ended = true;
                }

                data.forEach(one => {
                    $coursesbox.append(one.html);
                });

            } else {
                paging[uniqueid][view].ended = true;
            }

            loading = false;
            $tabcontent.removeClass('loading');

            if (paging[uniqueid][view].ended) {
                // If this tab for this uniqueid has no courses at all
                // on its first load, and this block comes from a
                // split-by-category section, hide the entire section
                // wrapper instead of showing an empty "no courses"
                // message inside the tab.
                if (paging[uniqueid][view].loaded === 0) {
                    var $section = $('[data-vitrina-uniqueid="' + uniqueid + '"]');
                    if ($section.length) {
                        $section.remove();
                        return;
                    }
                }

                $tabcontent.addClass('ended');
                $tabcontent.find('.loadmore').hide();

                var nocoursesbox = $tabcontent.find('.nocourses');
                var nocoursesmsg = '';
                if (paging[uniqueid][view].loaded == 0) {
                    nocoursesmsg = s.nocoursesview;
                    nocoursesbox.removeClass('hidden');
                } else {
                    // Only show the message if not is the first call when reached the end.
                    if (paging[uniqueid][view].loaded > bypage[uniqueid]) {
                        nocoursesmsg = s.nomorecourses;
                        nocoursesbox.removeClass('hidden');
                    }
                }
                nocoursesbox.html(nocoursesmsg);
            }
        },
        fail: function(e) {
            loading = false;
            $tabcontent.removeClass('loading');
            Notification.exception(e);
            Log.debug(e);
        }
    }]);

}

/**
 * Restart all controls to new course load.
 *
 * @param {integer} uniqueid
 */
function restartSearch(uniqueid) {
    paging[uniqueid] = [];
    $('#' + uniqueid + ' .block_vitrina-tabs [data-ref]').each(function() {
        var $tab = $(this);
        var $tabcontent = $($tab.attr('data-ref'));
        $tabcontent.removeClass('ended');
        $tabcontent.find('.loadmore').show();
        $tabcontent.find('.nocourses').addClass('hidden');
        $tabcontent.find('.courses-list').empty();
    });
}

/**
 * Component initialization.
 *
 * @method init
 *
 * @param {integer} uniqueid
 */
export const init = (uniqueid = null) => {

    loadStrings();

    $('[data-vitrina-toggle]').on('click', function() {
        var $this = $(this);
        var cssclass = $this.attr('data-vitrina-toggle');
        var target = $this.attr('data-target');

        $(target).toggleClass(cssclass);
    });

    if (uniqueid) {
        $('#' + uniqueid + '.block_vitrina-content').each(function() {
            var $blockcontent = $(this);

            // Manage tabs.
            $blockcontent.find('.block_vitrina-tabs').each(function() {
                var $tabs = $(this);
                var tabslist = [];

                $tabs.find('[data-ref]').each(function() {
                    var $tab = $(this);
                    var $tabcontent = $($tab.data('ref'));
                    tabslist.push($tab);

                    $tab.on('click', function() {
                        tabslist.forEach(one => {
                            $(one.data('ref')).removeClass('active');
                        });

                        $tabs.find('.active[data-ref]').removeClass('active');
                        $tab.addClass('active');

                        if ($tabcontent) {
                            $tabcontent.addClass('active');

                            // Load courses only the first time.
                            var view = $tabcontent.data('view');

                            if (paging[uniqueid][view] === undefined) {
                                loadCourses(uniqueid, $tabcontent);
                            }
                        }
                    });

                    $tabcontent.find('.loadmore').on('click', function() {
                        var $this = $(this);

                        // If is a link, do nothing. Only for buttons.
                        if ($this.attr('href')) {
                            return;
                        }

                        loadCourses(uniqueid, $tabcontent);
                    });
                });

                // Load dynamic buttons.
                $blockcontent.find('[data-vitrina-tab]').each(function() {
                    var $button = $(this);

                    $button.on('click', function() {
                        var key = '.tab-' + $button.data('vitrina-tab');

                        tabslist.forEach($tab => {
                            if ($tab.data('ref').indexOf(key) >= 0) {
                                $tab.trigger('click');
                            }
                        });
                    });
                });
            });

            // Make each course box clickable to open detail page.
            $blockcontent.on('click', '.block_vitrina-courseslist .coursebox', function(e) {
                var $target = $(e.target);

                // Do not hijack clicks on interactive elements (links, buttons, form controls).
                if ($target.closest('a, button, input, select, textarea').length) {
                    return;
                }

                var $box = $(this);
                var url = $box.data('vitrina-detailurl');
                var target = $box.data('vitrina-detailtarget') || '_self';

                if (url) {
                    if (target === '_blank') {
                        window.open(url, '_blank');
                    } else {
                        window.location.href = url;
                    }
                }
            });
        });
    }
};

/**
 * Initialize functions for the detail page.
 *
 */
export const detail = () => {
    strings.push({key: 'courselinkcopiedtoclipboard', component: 'block_vitrina'});

    $('input[name="courselink"]').on('click', function() {
        var $input = $(this);
        $input.select();
        document.execCommand("copy");

        var $msg = $('<div class="msg-courselink-copy">' + s.courselinkcopiedtoclipboard + '</div>');

        $input.parent().append($msg);
        window.setTimeout(function() {
            $msg.remove();
        }, 1600);
    });

    init();
};

/**
 * Initialize functions for the catalog page.
 *
 * @param {string} uniqueid
 * @param {string} view
 * @param {integer} currentinstanceid
 * @param {integer} currentbypage
 * @param {array} fixedfiltersArg Optional fixed filters to apply in all
 *        requests for this block instance (e.g. categories).
 */
export const catalog = (uniqueid, view, currentinstanceid = 0, currentbypage = 20, fixedfiltersArg = null) => {

    instanceid[uniqueid] = currentinstanceid;
    bypage[uniqueid] = parseInt(currentbypage);

    if (fixedfiltersArg) {
        fixedfilters[uniqueid] = fixedfiltersArg;
    }
    var $tabcontent = $('#' + uniqueid + ' .tabs-content .tab-' + view);

    loadCourses(uniqueid, $tabcontent);

    init(uniqueid);
};

/**
 * Initialize the filter controls.
 *
 * @param {integer} uniqueid
 * @param {array} selectedfilters
 */
export const filters = (uniqueid, selectedfilters = []) => {

    $filtersbox = $('#' + uniqueid);

    var applyFilters = function() {

        if (!loading) {
            restartSearch(uniqueid);
            loadCourses(uniqueid, $filtersbox.find('.block_vitrina-tabcontent.active'));
        }
    };

    selectedfilters.forEach(filter => {

        if (filter.key === 'fulltext') {
            $filtersbox.find('.filterfulltext input[name="q"]').val(filter.values.join(' '));
            return;
        }

        $filtersbox.find('.filtercontrol[data-key="' + filter.key + '"] .filteroptions').each(function() {
            var $filteroptions = $(this);

            filter.values.forEach(value => {
                $filteroptions.find('input[value="' + value + '"]').prop('checked', true);
            });
        });
    });

    $filtersbox.find('.filtercontrol .filteroptions input').on('change', applyFilters);
    $filtersbox.find('.filtersort select[name="sort"]').on('change', applyFilters);
    $filtersbox.find('.filtersortdirection select[name="sortdirection"]').on('change', applyFilters);
    $filtersbox.find('select[name="tagsfilter"]').on('change', applyFilters);

    $filtersbox.find('.filterfulltext button').on('click', applyFilters);
    $filtersbox.find('.filterfulltext input').on('keypress', function(e) {
        if (e.which == 13) {
            applyFilters();
        }
    });

    $filtersbox.find('.vitrina-filter-responsivebutton').on('click', function() {
        $filtersbox.addClass('opened-popup');
    });

    $filtersbox.find('.vitrina-filter-closebutton').on('click', function() {
        $filtersbox.removeClass('opened-popup');
    });

    // Initialize the category filter as a collapsible tree when there are
    // parent categories with children.
    var $categoryControl = $filtersbox.find('.filtercontrol[data-key="categories"]');
    if ($categoryControl.length) {

        var updateTreeExpansion = function() {
            $categoryControl.find('.filter-optiongroup.haschilds').each(function() {
                var $group = $(this);

                var hasSelectedDescendant = $group.find('ul.filteroptions input.filteroption:checked').length > 0;
                var isSelectedSelf = $group.find('> .filter-option > input.filteroption:checked').length > 0;
                var $icon = $group.find('> .filter-option .tree-toggle');

                if (hasSelectedDescendant || isSelectedSelf) {
                    $group.addClass('expanded');
                    $icon.removeClass('fa-plus-circle').addClass('fa-minus-circle');
                } else {
                    $group.removeClass('expanded');
                    $icon.removeClass('fa-minus-circle').addClass('fa-plus-circle');
                }
            });
        };

        // Initial expansion based on any preselected categories.
        updateTreeExpansion();

        // Toggle expand/collapse when clicking on the parent icon.
        $categoryControl.on('click', '.tree-toggle', function(e) {
            e.preventDefault();
            e.stopPropagation();

            var $group = $(this).closest('.filter-optiongroup.haschilds');
            $group.toggleClass('expanded');

            var $icon = $group.find('> .filter-option .tree-toggle');
            if ($group.hasClass('expanded')) {
                $icon.removeClass('fa-plus-circle').addClass('fa-minus-circle');
            } else {
                $icon.removeClass('fa-minus-circle').addClass('fa-plus-circle');
            }
        });

        // Keep expansion state in sync with checkbox changes.
        $categoryControl.on('change', 'input.filteroption', function() {
            updateTreeExpansion();
        });
    }

};
