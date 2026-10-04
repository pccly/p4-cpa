import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import auto_deploy


class AutoDeployTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / '.artifacts').mkdir()
        self.state = self.root / '.artifacts/deployment.json'
        self.calls = []
        self.current = 'a' * 40
        self.target = 'b' * 40
        self.dirty = ''
        self.branch = 'main'
        self.ci = 'success'
        self.failure = None
        self.running = 'cli-proxy-api\ncpa-manager-plus\nhttps'
        self.label = self.target
        self.patches = [
            patch.object(auto_deploy.ops, 'ROOT', self.root),
            patch.object(auto_deploy.ops, 'run', self.run_command),
            patch.object(auto_deploy.ops, 'compose', self.compose),
            patch.object(auto_deploy.ops, 'backup', self.backup),
            patch.dict(auto_deploy.os.environ, {}, clear=True),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def run_command(self, *args, **kwargs):
        self.calls.append(args)
        if args[:2] == ('git', 'status'): return self.dirty
        if args[:2] == ('git', 'branch'): return self.branch
        if args[:2] == ('git', 'rev-parse'):
            return self.current if args[2] == 'HEAD' else self.target
        if args[0] == 'gh':
            return json.dumps({'workflow_runs': [{'head_sha': self.target, 'status': 'completed', 'conclusion': self.ci}]})
        if args[:2] == ('docker', 'inspect'): return self.label
        return ''

    def compose(self, *args, **kwargs):
        self.calls.append(('compose', *args))
        if args[0] == self.failure: raise ValueError('simulated failure')
        if args[:2] == ('ps', '--status'): return self.running
        if args[:2] == ('ps', '-q'): return 'container-id'
        return ''

    def backup(self, on_created=None):
        self.calls.append(('backup',))
        if self.failure == 'backup': raise ValueError('simulated backup failure')
        archive = self.root / 'backup.tar.gz'
        if on_created: on_created(archive)
        if self.failure == 'restart': raise ValueError('simulated restart failure')
        return archive

    def test_success_pins_revision_and_backs_up_before_switching(self):
        auto_deploy.deploy()
        state = json.loads(self.state.read_text())
        self.assertEqual(state['status'], 'healthy')
        self.assertEqual(state['revision'], self.target)
        self.assertLess(self.calls.index(('backup',)), self.calls.index(('git', 'merge', '--ff-only', self.target)))
        self.assertEqual(auto_deploy.os.environ['P4_CPA_SOURCE_COMMIT'], self.target)
        self.assertEqual(auto_deploy.os.environ['BACKUP_KEEP'], '0')
        self.assertEqual(Path(auto_deploy.os.environ['BACKUP_DIR']).name, 'deployments')

    def test_retry_preserves_original_rollback_backup(self):
        original = '/backups/deployments/original.tar.gz'
        self.state.write_text(json.dumps({'status': 'failed', 'revision': self.current,
                                         'previous': 'c' * 40, 'backup': original}))
        auto_deploy.os.environ['P4_CPA_DEPLOY_RETRY'] = '1'
        auto_deploy.deploy()
        state = json.loads(self.state.read_text())
        self.assertEqual(state['previous'], 'c' * 40)
        self.assertEqual(state['backup'], original)
        self.assertIn(('backup',), self.calls)

    def test_failed_ci_does_not_mutate_checkout_or_stack(self):
        self.ci = 'failure'
        auto_deploy.deploy()
        self.assertFalse(self.state.exists())
        self.assertNotIn(('backup',), self.calls)
        self.assertFalse(any(call[:2] == ('git', 'merge') for call in self.calls))

    def test_dirty_or_wrong_branch_and_standby_are_rejected(self):
        for attr, value in [('dirty', ' M README.md'), ('branch', 'feature'), ('running', '')]:
            with self.subTest(attr=attr):
                original = getattr(self, attr)
                setattr(self, attr, value)
                with self.assertRaises(ValueError): auto_deploy.deploy()
                self.assertFalse(self.state.exists())
                setattr(self, attr, original)

    def test_failure_latches_even_when_backup_or_build_fails(self):
        for phase in ['backup', 'build', 'up']:
            with self.subTest(phase=phase):
                self.failure = phase
                auto_deploy.os.environ['P4_CPA_DEPLOY_RETRY'] = '1'
                with self.assertRaises(ValueError): auto_deploy.deploy()
                self.assertEqual(json.loads(self.state.read_text())['status'], 'failed')
                auto_deploy.os.environ.pop('P4_CPA_DEPLOY_RETRY')
                before = len(self.calls)
                with self.assertRaisesRegex(ValueError, 'paused'): auto_deploy.deploy()
                self.assertEqual(len(self.calls), before)

    def test_wrong_runtime_revision_never_reports_success(self):
        self.label = self.current
        with self.assertRaisesRegex(ValueError, 'revision'): auto_deploy.deploy()
        self.assertEqual(json.loads(self.state.read_text())['status'], 'failed')

    def test_backup_restart_failure_retains_created_archive(self):
        self.failure = 'restart'
        with self.assertRaisesRegex(ValueError, 'restart'): auto_deploy.deploy()
        state = json.loads(self.state.read_text())
        self.assertEqual(state['status'], 'failed')
        self.assertEqual(state['backup'], str(self.root / 'backup.tar.gz'))
        self.assertNotIn(('git', 'merge', '--ff-only', self.target), self.calls)

    def test_already_deployed_does_not_restart(self):
        self.state.write_text(json.dumps({'status': 'healthy', 'revision': self.target}))
        auto_deploy.deploy()
        self.assertNotIn(('backup',), self.calls)

    def test_matching_head_without_a_deployment_record_is_still_verified(self):
        self.current = self.target
        auto_deploy.deploy()
        self.assertIn(('compose', 'build'), self.calls)
        self.assertEqual(json.loads(self.state.read_text())['status'], 'healthy')

    def test_interrupted_state_pauses(self):
        self.state.write_text(json.dumps({'status': 'deploying', 'revision': self.target}))
        with self.assertRaisesRegex(ValueError, 'paused'): auto_deploy.deploy()
        self.assertEqual(self.calls, [])


class BackupRecoveryTests(unittest.TestCase):
    def test_archive_is_recorded_before_failed_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo'
            root.mkdir()
            for name in ['auths', 'data', 'plugins']:
                (root / name).mkdir()
            for name in ['.env', 'config.yaml', 'data/data.key', 'data/usage.sqlite']:
                (root / name).write_text('fixture')
            archives = []

            def compose(*args, **kwargs):
                if args[0] == 'ps': return 'cli-proxy-api'
                if args[0] == 'start': raise ValueError('restart failed')
                return ''

            with patch.object(auto_deploy.ops, 'ROOT', root), \
                 patch.object(auto_deploy.ops, 'compose', compose), \
                 patch.object(auto_deploy.ops, 'run', return_value='a' * 40), \
                 patch.dict(auto_deploy.os.environ, {'BACKUP_DIR': str(Path(directory) / 'backups'), 'BACKUP_KEEP': '0'}):
                with self.assertRaisesRegex(ValueError, 'restart failed'):
                    auto_deploy.ops.backup(on_created=archives.append)
            self.assertEqual(len(archives), 1)
            self.assertTrue(archives[0].is_file())


if __name__ == '__main__':
    unittest.main()
