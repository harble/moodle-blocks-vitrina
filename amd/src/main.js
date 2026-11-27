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

// Global categories "select all" tri-state shared between filters() and
// loadCourses(): 'all' | 'none' | 'single'.
var gCategoriesSelectAllState = 'all';
// When in 'single' mode and a node was clicked, the list of category values
// (the single clicked node). Empty means "run against ALL categories"
// (node-external trigger).
var gSingleNodeValues = [];

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

// Guard to bind the course actions menus only once.
var courseActionsMenusBound = false;

/**
 * Close a course actions dropdown.
 *
 * @param {object} $menu The dropdown jQuery element.
 */
function closeCourseActionsMenu($menu) {
    $menu.removeClass('menu-open');
    $menu.closest('.coursebox').removeClass('course-actions-open');
    $menu.find('.course-actions-toggle').attr('aria-expanded', 'false');
}

/**
 * Setup the course actions (three dots) menus interactions.
 *
 * The dropdown is rendered by the course templates and can appear in cards
 * loaded dynamically, so the events are delegated at document level.
 */
function setupCourseActionsMenus() {

    if (courseActionsMenusBound) {
        return;
    }

    courseActionsMenusBound = true;

    // Toggle the menu when its button is clicked.
    $(document).on('click', '.course-actions-toggle', function() {
        var $toggle = $(this);
        var $menu = $toggle.closest('.course-actions-menu');
        var $box = $toggle.closest('.coursebox');
        var isopen = $menu.hasClass('menu-open');

        // Close every other opened menu in the page.
        $(document).find('.course-actions-menu.menu-open').each(function() {
            if ($(this)[0] !== $menu[0]) {
                closeCourseActionsMenu($(this));
            }
        });

        if (isopen) {
            closeCourseActionsMenu($menu);
        } else {
            $menu.addClass('menu-open');
            $box.addClass('course-actions-open');
            $toggle.attr('aria-expanded', 'true');
        }
    });

    // Close the menus when clicking outside of them.
    $(document).on('click', function(e) {
        if ($(e.target).closest('.course-actions-menu').length) {
            return;
        }

        $(document).find('.course-actions-menu.menu-open').each(function() {
            closeCourseActionsMenu($(this));
        });
    });

    // Close the menus with the Escape key.
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' || e.keyCode === 27) {
            $(document).find('.course-actions-menu.menu-open').each(function() {
                closeCourseActionsMenu($(this));
            });
        }
    });

    // Add a course to / remove a course from the user favorites.
    $(document).on('click', '.course-actions-favorite', function(e) {
        e.preventDefault();
        e.stopPropagation();

        var $item = $(this);
        var courseid = $item.data('courseid');
        var isfavorite = parseInt($item.data('isfavorite'), 10) === 1;
        var favorite = !isfavorite;

        Ajax.call([{
            methodname: 'block_vitrina_toggle_favorite',
            args: {
                'courseid': courseid,
                'favorite': favorite
            },
            done: function(data) {
                if (data && data.isfavorite !== undefined) {
                    $('.course-actions-favorite[data-courseid="' + courseid + '"]').each(function() {
                        var $el = $(this);
                        $el.data('isfavorite', data.isfavorite ? 1 : 0);
                        $el.toggleClass('is-favorite', !!data.isfavorite);
                    });
                }
                closeCourseActionsMenu($item.closest('.course-actions-menu'));
                // Refresh the user_favorites block list in the side drawer, if present.
                if (window.require && $('.block_user_favorites').length) {
                    window.require(['block_user_favorites/favorites'], function(favoritesModule) {
                        if (favoritesModule && typeof favoritesModule.reload === 'function') {
                            favoritesModule.reload();
                        }
                    });
                }
            },
            fail: Notification.exception
        }]);
    });

    // Copy the course card link to the clipboard.
    $(document).on('click', '.course-actions-copylink', function(e) {
        e.preventDefault();
        e.stopPropagation();

        var $item = $(this);
        var link = $item.data('courselink');
        if (!link) {
            return;
        }

        var copyFallback = function() {
            var $tmp = $('<textarea>')
                .css({position: 'absolute', left: '-9999px', top: '0'})
                .val(link)
                .appendTo(document.body);
            $tmp.select();
            document.execCommand('copy');
            $tmp.remove();
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).catch(copyFallback);
        } else {
            copyFallback();
        }

        var $label = $item.find('.course-copylink-label');
        var originalLabel = $label.text();

        getStrings([{key: 'courselinkcopiedtoclipboard', component: 'block_vitrina'}])
            .then(function(results) {
                $label.text(results[0]);
                window.setTimeout(function() {
                    $label.text(originalLabel);
                }, 1600);
            })
            .catch(Notification.exception);
    });
}

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
 * @param {boolean} scrollToTop Whether to scroll to the top of the tab content after loading.
 */
function loadCourses(uniqueid, $tabcontent, scrollToTop) {

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

            // In "single-node" mode the individual category checkboxes are
            // hidden, so discard any residual checked state collected above
            // and decide below what to send.
            if (key === 'categories' && gCategoriesSelectAllState === 'single') {
                values = [];
            }

            if (values.length > 0) {
                filters.push({
                    'values': values,
                    'type': key
                });
            } else if (key === 'categories') {
                if (gCategoriesSelectAllState === 'single') {
                    if (gSingleNodeValues.length > 0) {
                        // Triggered by clicking a node: filter by that exact
                        // single node only.
                        filters.push({
                            'values': gSingleNodeValues,
                            'type': key
                        });
                    } else {
                        // Node-external trigger: query across all categories.
                        var allValues = [];
                        $control.find('input.filteroption').each(function() {
                            allValues.push($(this).val());
                        });
                        filters.push({
                            'values': allValues,
                            'type': key
                        });
                    }
                } else {
                    // User has explicitly unselected all categories.
                    // Send an explicit empty categories filter so the backend can
                    // distinguish this case from "no categories filter" and
                    // return no courses instead of falling back to defaults.
                    filters.push({
                        'values': [],
                        'type': key
                    });
                }
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

            // After a fresh search, scroll straight to the top of the page so the user
            // does not have to scroll up to see the new results (e.g. when
            // triggering a search from the bottom of a long category tree).
            // Only when explicitly requested by the caller, and only when the
            // results column top has scrolled more than 150px above the current
            // window top (otherwise the top of the results is still in view and
            // no jump is needed).
            if (scrollToTop) {
                var $resultscolTop = $('#vitrina-resultscol');
                var scrollTriggered = $resultscolTop.length &&
                    $resultscolTop.offset().top < $(window).scrollTop() - 150;
                if (scrollTriggered) {
                    if (window.requestAnimationFrame) {
                        window.requestAnimationFrame(function() {
                            $('html, body').animate({scrollTop: 0}, 'fast');
                        });
                    } else {
                        $('html, body').animate({scrollTop: 0}, 'fast');
                    }
                }
            }

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
 * Compute the paging geometry of a course list.
 *
 * Returns {pageView, maxScroll, totalPages} under the same model used by
 * refreshLineMode: one page equals one viewport width, paging snaps to full
 * page boundaries, and a trailing overflow narrower than a quarter of a card
 * is treated as "nothing to page through".
 *
 * Uses the cached values stored by refreshLineMode when available, so the
 * arrow handlers never need to recompute (and never read a transient,
 * in-flight scrollLeft during a smooth scroll animation).
 *
 * @param {object} el The courses-list DOM element.
 * @param {object} $tabcontent The active tabcontent jQuery object.
 * @returns {object}
 */
function linePaging(el, $tabcontent) {
    var cachedPages = $tabcontent.data('vitrina-line-totalpages');
    var cachedView = $tabcontent.data('vitrina-line-pageview');
    if (typeof cachedPages === 'number' && typeof cachedView === 'number') {
        return {
            pageView: cachedView,
            maxScroll: el.scrollWidth - el.clientWidth,
            totalPages: cachedPages
        };
    }
    var clientWidth = el.clientWidth;
    var scrollWidth = el.scrollWidth;
    var firstCard = el.children[0];
    var cardWidth = firstCard ? (firstCard.offsetWidth || 0) : 0;
    var pageView = Math.max(1, clientWidth);
    var maxScroll = scrollWidth - clientWidth;
    var minOverflow = Math.max(1, cardWidth * 0.25);
    var totalPages;
    if (maxScroll <= minOverflow) {
        totalPages = 1;
    } else {
        totalPages = Math.max(2, Math.ceil(maxScroll / pageView) + 1);
    }
    return {pageView: pageView, maxScroll: maxScroll, totalPages: totalPages};
}

/**
 * Flag that a programmatic (arrow) page jump is in flight.
 *
 * While the flag is set, refreshLineMode keeps the committed current page
 * index untouched, because the live scrollLeft during a smooth scroll is an
 * in-flight value that must not overwrite the page the arrows committed to.
 *
 * @param {object} $tabcontent The active tabcontent jQuery object.
 */
function flagLinePaging($tabcontent) {
    $tabcontent.data('vitrina-line-paging', true);
    var timer = $tabcontent.data('vitrina-line-paging-timer');
    if (timer) {
        window.clearTimeout(timer);
    }
    timer = window.setTimeout(function() {
        $tabcontent.data('vitrina-line-paging', false);
    }, 600);
    $tabcontent.data('vitrina-line-paging-timer', timer);
}

/**
 * Commit a new current page for the single-line mode and scroll to it.
 *
 * The arrow handlers never derive their jump target from the live scrollLeft
 * of a running smooth scroll (whose transient value used to absorb clicks and
 * deadlock on sub-pixel boundaries); they move the committed page index
 * instead, clamp it to the valid paging range and scroll to the matching page
 * offset. The committed index is written BEFORE the scroll so that any
 * refreshLineMode run while the animation is in flight (see flagLinePaging)
 * keeps the page the arrows committed to.
 *
 * @param {object} $tabcontent The active tabcontent jQuery object.
 * @param {object} el The courses-list DOM element.
 * @param {object} geometry The paging geometry from linePaging().
 * @param {integer} targetPage The 1-based page to navigate to.
 */
function setLinePage($tabcontent, el, geometry, targetPage) {
    targetPage = Math.max(1, Math.min(geometry.totalPages, targetPage));
    var targetLeft = (targetPage - 1) * geometry.pageView;
    $tabcontent.data('vitrina-line-current', targetPage);
    flagLinePaging($tabcontent);
    el.scrollLeft = Math.max(0, Math.min(geometry.maxScroll, targetLeft));
}

/**
 * Read the committed current page index (1-based) for a tab content.
 *
 * @param {object} $tabcontent The active tabcontent jQuery object.
 * @returns {integer}
 */
function getLineCurrentPage($tabcontent) {
    var currentPage = $tabcontent.data('vitrina-line-current');
    if (typeof currentPage !== 'number' || currentPage < 1) {
        return 1;
    }
    return currentPage;
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
    // All layout-affecting properties are read once, before any DOM write,
    // so later reads never force the browser to synchronously recompute the
    // layout (which would trigger "Forced reflow" warnings).
    var clientWidth = el.clientWidth;
    var scrollWidth = el.scrollWidth;
    var scrollLeft = el.scrollLeft;
    var firstCard = $list.children().first()[0];
    var cardWidth = firstCard ? (firstCard.offsetWidth || 0) : 0;

    var pageView = Math.max(1, clientWidth);
    var maxScroll = scrollWidth - clientWidth;

    // Apply a tolerance to the page count: a tiny overflow (less than a
    // quarter of a course card width) is treated as "nothing to page
    // through", so we only show the "More..." action. Once the overflow is
    // at least a quarter card wide it is worth a second page, so the page
    // indicator and the arrows stay visible.
    var minOverflow = Math.max(1, cardWidth * 0.25);
    var totalPages;
    if (maxScroll <= 0) {
        totalPages = 1;
    } else if (maxScroll <= minOverflow) {
        // Negligible overflow: keep a single page, only "More..." applies.
        totalPages = 1;
    } else {
        // Meaningful overflow. Pages are aligned to one viewport width each, and
        // any trailing overflow narrower than a full viewport counts as one
        // extra (final) page, so the last arrow click reveals the leftover
        // tail instead of being lumped into the previous page.
        totalPages = Math.max(2, Math.ceil(maxScroll / pageView) + 1);
    }

    // Cache the paging geometry for the arrow handlers (see linePaging), so
    // they never have to read transient layout values (above all the
    // in-flight scrollLeft of a smooth scroll animation) to compute their
    // next jump target.
    $tabcontent.data('vitrina-line-totalpages', totalPages);
    $tabcontent.data('vitrina-line-pageview', pageView);

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

    // The committed page index (1-based) is the source of truth driving the
    // arrows. While a programmatic jump is in flight (the paging flag is
    // set), the live scrollLeft is a transient in-flight value and must NOT
    // overwrite the committed index. That is exactly why refreshing during a
    // smooth scroll never re-derives the arrows' page from the moving pixels.
    // Otherwise, re-sync from the real scroll position (manual scrolling,
    // window resizes, etc.). A +1px epsilon is added before flooring so a
    // sub-pixel settle just below a page boundary (e.g. 987.33px in a 987.33
    // viewport) still counts as the next page instead of rounding all the way
    // back, which is what made repeated clicks appear to "do nothing".
    var committedPage = $tabcontent.data('vitrina-line-current');
    if (typeof committedPage !== 'number' || committedPage < 1) {
        committedPage = 1;
    }
    if (!$tabcontent.data('vitrina-line-paging')) {
        var livePage;
        if (scrollLeft + clientWidth >= scrollWidth - 2) {
            livePage = totalPages;
        } else {
            livePage = Math.floor((scrollLeft + 1) / pageView) + 1;
            if (livePage < 1) {
                livePage = 1;
            }
        }
        committedPage = Math.min(livePage, totalPages);
        $tabcontent.data('vitrina-line-current', committedPage);
    } else if (committedPage > totalPages) {
        committedPage = totalPages;
        $tabcontent.data('vitrina-line-current', committedPage);
    }
    $current.text(committedPage);
    $total.text(totalPages);

    // Arrows.
    var $prev = $controls.find('.vitrina-line-prev');
    var $next = $controls.find('.vitrina-line-next');

    if (committedPage <= 1) {
        $prev.addClass('vitrina-line-disabled');
    } else {
        $prev.removeClass('vitrina-line-disabled');
    }

    // Show the "More..." label on the next arrow when there is more to load
    // and either we are fully at the end, or the whole row is a tiny overflow
    // (totalPages <= 1) that does not need pagination but still has more.
    if ((committedPage >= totalPages || totalPages <= 1) && hasMore) {
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
        if (committedPage >= totalPages) {
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

    // Prev: move back one committed page. The target never depends on the live
    // scrollLeft (which is transient during a smooth scroll animation), only on
    // the committed page index, so repeated fast clicks can never be absorbed
    // into the current page or deadlock on a sub-pixel boundary.
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
        setLinePage($tabcontent, el, linePaging(el, $tabcontent), getLineCurrentPage($tabcontent) - 1);
    });

    // Next: move forward one committed page, or open the "view more" page when
    // the committed page is already at the end (or the row is a tiny overflow)
    // and a "view all" link exists. Like Prev, the decision and the jump target
    // come from the committed page index and the cached paging geometry, never
    // from the transient scrollLeft of a running smooth scroll.
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

        var currentPage = getLineCurrentPage($tabcontent);
        var geometry = linePaging(el, $tabcontent);

        // Whether there are still more course records not yet loaded/shown.
        var hasMore = false;
        var view = $tabcontent.data('view');
        if (paging[uniqueid] !== undefined && paging[uniqueid][view] !== undefined) {
            hasMore = !paging[uniqueid][view].ended;
        }
        var hasMoreLink = $tabcontent.find('.loadmore[href]').length > 0;

        if ((currentPage >= geometry.totalPages || geometry.totalPages <= 1) && hasMore && hasMoreLink) {
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

        if (currentPage >= geometry.totalPages) {
            return;
        }

        setLinePage($tabcontent, el, geometry, currentPage + 1);
    });

    // Keep the controls in sync while scrolling any tab's course list. The
    // handler is throttled to one run per animation frame (a smooth scroll
    // fires a scroll event each frame) to avoid doing layout reads and DOM
    // writes several times per frame while the row is animating.
    $blockcontent.find('.block_vitrina-tabcontent').each(function() {
        var $tabcontent = $(this);
        var rafPending = false;
        $tabcontent.find('.courses-list').on('scroll', function() {
            if (rafPending) {
                return;
            }
            rafPending = true;
            window.requestAnimationFrame(function() {
                rafPending = false;
                refreshLineMode(uniqueid, $tabcontent);
            });
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
    setupCourseActionsMenus();

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

    setupCourseActionsMenus();

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
    var $categoryControl = $filtersbox.find('.filtercontrol[data-key="categories"]');

    var applyFilters = function(fromNode) {

        // A node-external trigger while in single-node mode: drop the active
        // single-node scope and search across ALL categories (as if every
        // category were selected), and clear the node highlight.
        if (gCategoriesSelectAllState === 'single' && !fromNode) {
            gSingleNodeValues = [];
            if ($categoryControl.length) {
                $categoryControl.find('.filter-option')
                    .removeClass('vitrina-node-selected vitrina-node-ancestor');
            }
        }

        if (!loading) {
            restartSearch(uniqueid);
            loadCourses(uniqueid, $filtersbox.find('.block_vitrina-tabcontent.active'), true);
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

    $filtersbox.find('.filtercontrol .filteroptions input').on('change', function() { applyFilters(); });
    $filtersbox.find('.filtersort select[name="sort"]').on('change', function() { applyFilters(); });
    $filtersbox.find('.filtersortdirection select[name="sortdirection"]').on('change', function() { applyFilters(); });
    $filtersbox.find('select[name="tagsfilter"]').on('change', function() { applyFilters(); });

    $filtersbox.find('.filterfulltext button').on('click', function() { applyFilters(); });
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
    if ($categoryControl.length) {

        // Keep the state of the optional "select all" checkbox.
        var $selectAllCategories = $categoryControl.find('.vitrina-categories-selectall');

        // Tri-state selector for the categories "select all" checkbox.
        // 'all'    -> every category selected;
        // 'none'   -> no category selected (backend returns no courses);
        // 'single' -> "single-node" mode: category checkboxes are hidden and
        //             clicking any node selects only that exact single node;
        //             queries triggered outside the tree (fulltext/sort/...)
        //             run against ALL categories.
        var selectAllState = 'all';

        // Sync the "select all" checkbox visual state according to the current
        // tri-state mode. Pure UI: it never triggers searches.
        var refreshSelectAllUI = function() {
            if (!$selectAllCategories.length) {
                return;
            }

            // Drive the visual state through a dedicated data-state attribute so
            // we never rely on the native :checked / :indeterminate pseudo-classes
            // (which Boost Union and some browsers render unreliably).
            if (selectAllState === 'single') {
                $categoryControl.addClass('vitrina-single-mode');
                $selectAllCategories.attr('data-state', 'single');
                $selectAllCategories.prop('indeterminate', false);
                $selectAllCategories.prop('checked', false);
            } else {
                $categoryControl.removeClass('vitrina-single-mode');
                $selectAllCategories.prop('indeterminate', false);
                if (selectAllState === 'all') {
                    $selectAllCategories.prop('checked', true);
                    $selectAllCategories.attr('data-state', 'all');
                } else {
                    $selectAllCategories.prop('checked', false);
                    $selectAllCategories.attr('data-state', 'none');
                }
            }
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

        // Initial sync for the select-all checkbox. The URL parameter
        // "single=1" makes the catalog page boot directly into single-node
        // mode (checkbox shows the dash, node checkboxes hidden).
        var urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('single') === '1') {
            selectAllState = 'single';
            gCategoriesSelectAllState = 'single';
            gSingleNodeValues = [];
            $categoryControl.find('input.filteroption').prop('checked', false);
        } else {
            selectAllState = 'all';
            gCategoriesSelectAllState = 'all';
        }
        refreshSelectAllUI();

        // When a node is clicked in "single-node" mode, select that exact single
        // node (its category value), highlight it and its ancestors, and
        // trigger a node-scoped search.
        if ($selectAllCategories.length) {
            $categoryControl.on('click', '.filter-option label', function(e) {
                if (selectAllState !== 'single') {
                    return;
                }
                // Prevent the native label->checkbox toggling: in single-node
                // mode we drive the selection entirely from here.
                e.preventDefault();
                e.stopPropagation();

                var $label = $(this);
                var $option = $label.closest('.filter-option');
                var $checkbox = $option.find('.filteroption').first();
                if (!$checkbox.length || $checkbox.prop('disabled')) {
                    return;
                }

                var categoryvalue = String($checkbox.val() || '').trim();
                if (categoryvalue === '') {
                    return;
                }

                // Highlight the selected node and all its ancestors.
                $categoryControl.find('.filter-option').removeClass('vitrina-node-selected');
                $option.addClass('vitrina-node-selected');
                $option.parents('.filter-optiongroup').addClass('vitrina-node-ancestor');

                // Store the exact single node as the active scope.
                gSingleNodeValues = [categoryvalue];
                gCategoriesSelectAllState = 'single';

                // Expand the tree towards the selected node if collapsed.
                $option.parents('.filter-optiongroup.haschilds').addClass('expanded');
                var $icon = $option.parents('.filter-optiongroup.haschilds')
                    .find('> .filter-option .tree-toggle');
                $icon.removeClass('fa-plus-circle').addClass('fa-minus-circle');

                applyFilters(true);
            });
        }

        // Toggle all categories. Because the "select all" checkbox supports a
        // third (indeterminate) state, we drive the cycle with click events:
        // 'all' -> 'none' -> 'single' -> 'all'.
        if ($selectAllCategories.length) {
            $selectAllCategories.on('click', function(e) {
                e.preventDefault();

                var next;
                if (selectAllState === 'all') {
                    next = 'none';
                } else if (selectAllState === 'none') {
                    next = 'single';
                } else {
                    next = 'all';
                }

                selectAllState = next;
                gCategoriesSelectAllState = next;

                if (next === 'single') {
                    // Enter single-node mode: clear any previous node scope.
                    gSingleNodeValues = [];
                } else {
                    gSingleNodeValues = [];

                    // In 'all' and 'none' the select-all checkbox also drives
                    // the underlying node checkboxes (historical behaviour).
                    var $allCategoryCheckboxes = $categoryControl.find('input.filteroption');
                    $allCategoryCheckboxes.prop('checked', (next === 'all'));
                }

                // Remove node highlighting when leaving single-node mode.
                if (next !== 'single') {
                    $categoryControl.find('.filter-option')
                        .removeClass('vitrina-node-selected vitrina-node-ancestor');
                }

                refreshSelectAllUI();
                applyFilters();
            });
        }

        // Expand/collapse the whole tree when clicking the icon next to the
        // "categories" title.
        $categoryControl.on('click', '.tree-toggle-all', function(e) {
            e.preventDefault();
            e.stopPropagation();

            // If at least one parent node is still collapsed, expand all;
            // otherwise collapse everything.
            var expandAll = $categoryControl.find('.filter-optiongroup.haschilds:not(.expanded)').length > 0;

            $categoryControl.find('.filter-optiongroup.haschilds').each(function() {
                var $group = $(this);
                $group.toggleClass('expanded', expandAll);
                var $icon = $group.find('> .filter-option .tree-toggle');
                if (expandAll) {
                    $icon.removeClass('fa-plus-circle').addClass('fa-minus-circle');
                } else {
                    $icon.removeClass('fa-minus-circle').addClass('fa-plus-circle');
                }
            });

            var $selfIcon = $(this);
            if (expandAll) {
                $selfIcon.removeClass('fa-plus-circle').addClass('fa-minus-circle');
            } else {
                $selfIcon.removeClass('fa-minus-circle').addClass('fa-plus-circle');
            }
        });

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

        // Keep expansion state in sync with checkbox changes. In single-node
        // mode the generic change handler is not used (nodes are handled by the
        // label click binding), but we still refresh the select-all UI.
        $categoryControl.on('change', 'input.filteroption', function() {
            updateTreeExpansion();
            if (selectAllState === 'single') {
                return;
            }
            var $allCategoryCheckboxes = $categoryControl.find('input.filteroption');
            if ($allCategoryCheckboxes.length === 0) {
                selectAllState = 'none';
            } else {
                selectAllState = ($allCategoryCheckboxes.filter(':checked').length === $allCategoryCheckboxes.length)
                    ? 'all' : 'none';
            }
            gCategoriesSelectAllState = selectAllState;
            refreshSelectAllUI();
        });
    }

};