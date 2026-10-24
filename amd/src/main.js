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
    {key: 'loadmoreloadedcount', component: 'block_vitrina'},
    {key: 'viewall', component: 'block_vitrina'},
    {key: 'layoutmode_more', component: 'block_vitrina'},
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
 * Update the load-more button label with loaded count for current tab.
 *
 * @param {integer} uniqueid
 * @param {object} $tabcontent
 * @param {?integer} forcedloaded Optional explicit loaded count.
 */
function updateLoadMoreButtonLabel(uniqueid, $tabcontent, forcedloaded = null) {
    var view = $tabcontent.data('view');
    var loaded = 0;

    if (forcedloaded !== null && forcedloaded !== undefined) {
        loaded = parseInt(forcedloaded, 10) || 0;
    } else if (
        paging[uniqueid] !== undefined &&
        paging[uniqueid][view] !== undefined &&
        paging[uniqueid][view].loaded !== undefined
    ) {
        loaded = parseInt(paging[uniqueid][view].loaded, 10) || 0;
    }

    $tabcontent.find('.loadmore').each(function() {
        var $button = $(this);
        var basetext = $button.attr('data-loadmore-base');
        var counttext = '';

        if (!basetext) {
            basetext = ($button.text() || '').trim();
            basetext = basetext.replace(/\s*[（(][^)）]*[）)]\s*$/u, '');
            $button.attr('data-loadmore-base', basetext);
        }

        if (s.loadmoreloadedcount && s.loadmoreloadedcount !== 'loadmoreloadedcount') {
            counttext = s.loadmoreloadedcount.replace('{$a}', loaded);
        } else {
            counttext = '（已加载 ' + loaded + ' 条）';
        }

        $button.text(basetext + ' ' + counttext);
    });
}

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

            updateLoadMoreButtonLabel(uniqueid, $tabcontent);
            refreshLineMode(uniqueid, $tabcontent);

            if (paging[uniqueid][view].ended) {
                // If this tab for this uniqueid has no courses at all
                // AND no other tab for this block instance has ever
                // loaded courses, and this block comes from a
                // split-by-category section, hide the entire section
                // wrapper instead of showing an empty "no courses"
                // message inside the tab. Once any tab has shown
                // courses, later empty tabs should just show the
                // "no courses" message and keep the block visible.
                if (paging[uniqueid][view].loaded === 0) {
                    var totalloaded = 0;

                    if (paging[uniqueid] !== undefined) {
                        Object.keys(paging[uniqueid]).forEach(function(viewkey) {
                            if (paging[uniqueid][viewkey] !== undefined) {
                                totalloaded += paging[uniqueid][viewkey].loaded;
                            }
                        });
                    }

                    if (totalloaded === 0) {
                        var $section = $('[data-vitrina-uniqueid="' + uniqueid + '"]');
                        if ($section.length) {
                            $section.remove();
                            return;
                        }
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
 * Refresh the single-line (horizontal scroll) controls for a tab content.
 *
 * Shows the controls only when there is overflow, updates the "N/Count"
 * indicator, toggles the disabled state of the arrows and turns the right
 * arrow into a "More" button when scrolled to the end AND a "view more"
 * link is available for this tab.
 *
 * @param {integer} uniqueid
 * @param {object} $tabcontent
 */
function refreshLineMode(uniqueid, $tabcontent) {
    var $blockcontent = $tabcontent.closest('.block_vitrina-content');
    if (!$blockcontent.hasClass('vitrina-layout-line')) {
        return;
    }

    // The N/Pages indicator (".vitrina-line-controls") is shared at block
    // level, so it MUST reflect only the currently active tab. When another
    // tab is clicked away, its list becomes display:none and its ResizeObserver
    // fires a delayed refresh with zero/empty data. That would wrongly overwrite
    // the shared control visibility and hide it. Ignore refreshes for any tab
    // that is not active so only the active one drives the shared controls.
    if (!$tabcontent.hasClass('active')) {
        return;
    }

    var $list = $tabcontent.find('.courses-list').first();
    var $controls = $blockcontent.find('.vitrina-line-controls').first();
    if (!$list.length || !$controls.length) {
        return;
    }

    var $current = $controls.find('.vitrina-line-current');
    var $total = $controls.find('.vitrina-line-total');

    var el = $list[0];

    // Whether there are still more course records not yet loaded/shown.
    var hasMore = false;
    var view = $tabcontent.data('view');
    if (paging[uniqueid] !== undefined && paging[uniqueid][view] !== undefined) {
        hasMore = !paging[uniqueid][view].ended;
    }

    // The N/Pages indicator and prev arrow must always be visible whenever
    // pagination applies (totalPages > 1), even if disabled. A "page" is one
    // viewport width and paging snaps to full-page boundaries (Math.floor),
    // so the total page count must use the same floor model as currentPage.
    // Computing totalPages early lets us drive visibility from it (robust)
    // instead of from the error-prone geometric overflow calculation below.
    var pageView = Math.max(1, el.clientWidth);
    var maxScroll = el.scrollWidth - el.clientWidth;

    // Apply a tolerance to the page count: a tiny overflow (less than a
    // quarter of a course card width) is treated as "nothing to page
    // through", so we only show the "More..." action. Once the overflow is
    // at least a quarter card wide it is worth a second page, so the page
    // indicator and the arrows stay visible.
    var cardWidth = 0;
    var firstCard = $list.children().first()[0];
    if (firstCard) {
        cardWidth = firstCard.offsetWidth || 0;
    }
    var minOverflow = Math.max(1, cardWidth * 0.25);
    var totalPages;
    if (maxScroll <= 0) {
        totalPages = 1;
    } else if (maxScroll <= minOverflow) {
        // Negligible overflow: keep a single page, only "More..." applies.
        totalPages = 1;
    } else {
        // Meaningful overflow: at least a second page.
        totalPages = Math.max(2, Math.floor(maxScroll / pageView) + 1);
    }

    // Show the controls whenever the content spans more than one page OR there
    // is still more to load. When there is nothing to page through but more
    // records exist, only the "More..." action is relevant.
    var showcontrols = hasMore || totalPages > 1;

    // Show/hide the whole control bar based on paging and remaining items.
    // The controls live next to the tab bar, so toggle on the block root.
    $blockcontent.toggleClass('has-overflow', showcontrols);

    // "More only" mode applies only when there is a single page (nothing to
    // paginate) but more records exist to load: hide the page indicator and
    // the prev arrow, leaving just the "More..." action. Whenever totalPages
    // > 1 this is never set, so N/Pages and the prev arrow stay visible.
    $blockcontent.toggleClass('vitrina-line-moreonly', hasMore && totalPages <= 1);

    // Determine whether the row is scrolled fully to the end.
    var atEnd = (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);

    // The current page must use the same 1/4-card tolerance model as
    // totalPages: jumping straight to the end (e.g. when the overflow is less
    // than a full screen but already counts as a second page) should report
    // the last page instead of a stale floor() value.
    var currentPage;
    if (totalPages <= 1 || atEnd) {
        currentPage = atEnd ? totalPages : 1;
    } else {
        currentPage = Math.floor(el.scrollLeft / pageView) + 1;
        if (currentPage < 1) {
            currentPage = 1;
        }
        if (currentPage > totalPages) {
            currentPage = totalPages;
        }
    }
    $current.text(currentPage);
    $total.text(totalPages);

    // Arrows.
    var $prev = $controls.find('.vitrina-line-prev');
    var $next = $controls.find('.vitrina-line-next');

    if (el.scrollLeft <= 0) {
        $prev.addClass('vitrina-line-disabled');
    } else {
        $prev.removeClass('vitrina-line-disabled');
    }

    // Show the "More..." label on the next arrow when there is more to load
    // and either we are fully at the end, or the whole row is a tiny overflow
    // (totalPages <= 1) that does not need pagination but still has more.
    if ((atEnd || totalPages <= 1) && hasMore) {
        $next.removeClass('vitrina-line-disabled');
        if (!$next.hasClass('vitrina-line-more-btn')) {
            $next.addClass('vitrina-line-more-btn');
            var moreText = $next.find('.vitrina-line-more-text');
            if (!moreText.length) {
                moreText = $('<span class="vitrina-line-more-text"></span>');
                $next.prepend(moreText);
            }
            var moreLabel = s.layoutmode_more || s.viewall || 'More';
            moreText.text(moreLabel);
        }
    } else {
        $next.removeClass('vitrina-line-more-btn');
        if (atEnd) {
            // At the very end and no more records: not clickable.
            $next.addClass('vitrina-line-disabled');
        } else {
            // Can still scroll right: clickable.
            $next.removeClass('vitrina-line-disabled');
        }
    }
}

/**
 * Bind the interactive behaviour of the single-line controls for a block.
 *
 * The controls are shared at block level (right of the tab bar) and act on
 * the currently active tab's course list.
 *
 * @param {integer} uniqueid
 * @param {object} $blockcontent
 */
function setupLineControls(uniqueid, $blockcontent) {
    if ($blockcontent.data('vitrina-line-bound')) {
        return;
    }
    $blockcontent.data('vitrina-line-bound', true);

    var $controls = $blockcontent.find('.vitrina-line-controls').first();
    if (!$controls.length) {
        return;
    }
    var $prev = $controls.find('.vitrina-line-prev');
    var $next = $controls.find('.vitrina-line-next');

    // Resolve the currently active tabcontent and its course list.
    // eslint-disable-next-line jsdoc/require-jsdoc
    function activeTabParts() {
        var $tabcontent = $blockcontent.find('.block_vitrina-tabcontent.active').first();
        if (!$tabcontent.length) {
            $tabcontent = $blockcontent.find('.block_vitrina-tabcontent').first();
        }
        var $list = $tabcontent.find('.courses-list').first();
        return {tabcontent: $tabcontent, list: $list};
    }

    // Prev: scroll the active tab's list one page (one viewport width) to the left.
    $prev.on('click', function() {
        if ($(this).hasClass('vitrina-line-disabled')) {
            return;
        }
        var parts = activeTabParts();
        var el = parts.list[0];
        var $tabcontent = parts.tabcontent;
        if (!el) {
            return;
        }
        var pageView = Math.max(1, el.clientWidth);
        var target = Math.max(0, Math.floor(el.scrollLeft / pageView) * pageView - pageView);
        el.scrollLeft = target;
        window.setTimeout(function() {
            refreshLineMode(uniqueid, $tabcontent);
        }, 80);
    });

    // Next: scroll the active tab's list one card width to the right, or open
    // the "view more" page when at the end and a "view all" link exists.
    $next.on('click', function() {
        if ($(this).hasClass('vitrina-line-disabled') && !$(this).hasClass('vitrina-line-more-btn')) {
            return;
        }
        var parts = activeTabParts();
        var el = parts.list[0];
        var $tabcontent = parts.tabcontent;
        if (!el) {
            return;
        }
        var atEnd = (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);

        // Whether there are still more course records not yet loaded/shown.
        var hasMore = false;
        var view = $tabcontent.data('view');
        if (paging[uniqueid] !== undefined && paging[uniqueid][view] !== undefined) {
            hasMore = !paging[uniqueid][view].ended;
        }
        var hasMoreLink = $tabcontent.find('.loadmore[href]').length > 0;

        if (atEnd && hasMore && hasMoreLink) {
            // The loadmore link carries the configured "open detail in" target
            // (block_vitrina/opendetailstarget) in its target attribute, so the
            // "More..." button must honour it just like the tile-mode loadmore
            // button does (instead of always navigating in the current window).
            var $more = $tabcontent.find('.loadmore[href]').first();
            var moreTarget = $more.attr('target') || '_self';
            if (moreTarget === '_blank') {
                window.open($more.attr('href'), '_blank');
            } else {
                window.location.href = $more.attr('href');
            }
            return;
        }

        if (atEnd) {
            return;
        }

        var pageView = Math.max(1, el.clientWidth);
        var maxScroll = el.scrollWidth - el.clientWidth;
        var target = Math.min(maxScroll, (Math.floor(el.scrollLeft / pageView) + 1) * pageView);
        el.scrollLeft = target;
        window.setTimeout(function() {
            refreshLineMode(uniqueid, $tabcontent);
        }, 100);
    });

    // Keep the controls in sync while scrolling any tab's course list.
    $blockcontent.find('.block_vitrina-tabcontent').each(function() {
        var $tabcontent = $(this);
        $tabcontent.find('.courses-list').on('scroll', function() {
            refreshLineMode(uniqueid, $tabcontent);
        });
        // Re-evaluate the controls whenever the list is resized (e.g. the
        // browser window is resized), so the N/Pages indicator and the
        // arrows are shown/hidden and recomputed dynamically.
        if (window.ResizeObserver) {
            var $list = $tabcontent.find('.courses-list').first();
            var ro = new ResizeObserver(function() {
                if (uniqueid && uniqueid.length && !loading) {
                    window.setTimeout(function() {
                        refreshLineMode(uniqueid, $tabcontent);
                    }, 20);
                }
            });
            ro.observe($list[0]);
            $tabcontent.data('vitrina-line-ro', ro);
        }
    });
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
        updateLoadMoreButtonLabel(uniqueid, $tabcontent, 0);
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

                            // Refresh the single-line controls for the now active tab. The list is
                            // coming from display:none, so wait until the browser
                            // has laid it out (next frame) before reading its
                            // width, otherwise clientWidth/scrollWidth are stale
                            // (often 0) and the shared controls get hidden.
                            if ($blockcontent.hasClass('vitrina-layout-line')) {
                                window.requestAnimationFrame(function() {
                                    refreshLineMode(uniqueid, $tabcontent);
                                });
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

                    setupLineControls(uniqueid, $blockcontent);
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

        // Keep the state of the optional "select all" checkbox in sync
        // with the individual category checkboxes.
        var $selectAllCategories = $categoryControl.find('.vitrina-categories-selectall');

        var syncSelectAllCategories = function() {
            if (!$selectAllCategories.length) {
                return;
            }

            var $allCategoryCheckboxes = $categoryControl.find('input.filteroption');
            if ($allCategoryCheckboxes.length === 0) {
                $selectAllCategories.prop('checked', false);
                return;
            }

            var allChecked = $allCategoryCheckboxes.filter(':checked').length === $allCategoryCheckboxes.length;
            $selectAllCategories.prop('checked', allChecked);
        };

        var updateTreeExpansion = function() {
            $categoryControl.find('.filter-optiongroup.haschilds').each(function() {
                var $group = $(this);

                var hasSelectedDescendant = $group.find('ul.filteroptions input.filteroption:checked').length > 0;
                var isSelectedSelf = $group.find('> .filter-option > input.filteroption:checked').length > 0;
                var $icon = $group.find('> .filter-option .tree-toggle');

                if (hasSelectedDescendant || isSelectedSelf) {
                    $group.addClass('expanded');
                    $icon.removeClass('fa-plus-circle').addClass('fa-minus-circle');
                }
            });
        };

        // Initial expansion based on any preselected categories.
        updateTreeExpansion();
        syncSelectAllCategories();

        // Toggle all categories when the "select all" checkbox changes.
        if ($selectAllCategories.length) {
            $selectAllCategories.on('change', function() {
                var checked = $(this).is(':checked');

                // Select/unselect all category checkboxes (including children).
                $categoryControl.find('input.filteroption').prop('checked', checked);

                // Update tree UI and re-sync the select-all state.
                updateTreeExpansion();
                syncSelectAllCategories();

                // Apply filters so the catalog reloads according to the
                // new category selection.
                applyFilters();
            });
        }

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
            syncSelectAllCategories();
        });
    }

};