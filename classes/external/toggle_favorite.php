<?php
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
 * This class contains the toggle favorite webservice function.
 *
 * @package    block_vitrina
 * @copyright  2024 David Herney @ BambuCo
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

declare(strict_types=1);

namespace block_vitrina\external;

use external_api;
use external_function_parameters;
use external_value;
use external_single_structure;

defined('MOODLE_INTERNAL') || die();

require_once($CFG->libdir . '/externallib.php');

/**
 * Service implementation.
 *
 * @copyright   2024 David Herney - cirano
 * @license     https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class toggle_favorite extends external_api {
    /**
     * Returns description of method parameters.
     *
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters(
            [
                'courseid' => new external_value(PARAM_INT, 'Course id'),
                'favorite' => new external_value(PARAM_BOOL, 'True to add the course to favorites, false to remove it'),
            ]
        );
    }

    /**
     * Add or remove a course from the favorites of the current user.
     *
     * @param int $courseid Course id
     * @param bool $favorite True to add the course to favorites, false to remove it
     * @return array The new favorite state
     */
    public static function execute(int $courseid, bool $favorite): array {
        global $USER;

        $params = self::validate_parameters(
            self::execute_parameters(),
            [
                'courseid' => $courseid,
                'favorite' => $favorite,
            ]
        );

        $syscontext = \context_system::instance();
        self::validate_context($syscontext);

        if (isguestuser() || !isloggedin()) {
            throw new \moodle_exception('invaliduser');
        }

        if (!class_exists('\\block_user_favorites\\favorites')) {
            throw new \moodle_exception('favoritesunavailable', 'block_vitrina');
        }

        $course = get_course($params['courseid']);
        $url = (string)(new \moodle_url('/course/view.php', ['id' => $course->id]));
        $favorites = new \block_user_favorites\favorites((int)$USER->id);

        if ($params['favorite']) {
            $favorites->set_by_url($url, format_string($course->fullname), 0, 'course');
        } else {
            $favorites->delete_by_hash(md5($url));
        }

        return ['isfavorite' => $params['favorite']];
    }

    /**
     * Returns description of method result value.
     *
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure(
            [
                'isfavorite' => new external_value(PARAM_BOOL, 'New favorite state'),
            ]
        );
    }
}